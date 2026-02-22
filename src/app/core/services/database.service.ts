import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { AuthService, User } from './auth.service';
import { SyncLoggerService } from './sync-logger.service';
import { PouchDB } from '../../app';
import { environment } from '../../../environments/environment';

// Minimal static type for the PouchDB constructor when loaded via ESM
interface PouchDBStatic {
  new (nameOrUrl: string, options?: PouchDB.Configuration.DatabaseConfiguration): PouchDB.Database;
  plugin(plugin: unknown): void;
}

// Minimal replication sync interface used by this service
interface PouchSync {
  on(event: string, handler: (info: unknown) => void): PouchSync;
  off(event: string, handler?: (info: unknown) => void): PouchSync;
  cancel(): void;
}

export interface SyncStatus {
  isOnline: boolean;
  isSync: boolean;
  isConnecting?: boolean;
  lastSync?: Date;
  error?: string;
  syncProgress?: {
    docsProcessed: number;
    totalDocs?: number;
    operation: 'push' | 'pull';
    currentDoc?: {
      id: string;
      type?: string;
      title?: string;
    };
    pendingDocs?: number;
  };
}

@Injectable({
  providedIn: 'root'
})
export class DatabaseService {
  private readonly authService = inject(AuthService);
  private readonly syncLogger = inject(SyncLoggerService);
  
  private db: PouchDB.Database | null = null;
  private remoteDb: PouchDB.Database | null = null;
  private syncHandler: PouchSync | null = null;
  private initializationPromise: Promise<void> | null = null;
  private syncStatusSubject = new BehaviorSubject<SyncStatus>({
    isOnline: navigator.onLine,
    isSync: false
  });

  // Runtime reference to the PouchDB constructor loaded via ESM
  // Types for PouchDB usage remain via the ambient PouchDB namespace
  private pouchdbCtor: PouchDBStatic | null = null;

  // Track the active story for selective sync
  private activeStoryId: string | null = null;

  // Track if sync is temporarily paused (e.g., during AI streaming)
  private syncPaused = false;
  private activePauseCount = 0;

  // Track if sync has been initialized (to prevent premature sync before user choice)
  private syncInitialized = false;

  // Event handler references for proper cleanup
  private handleOnline = () => this.updateOnlineStatus(true);
  private handleOffline = () => this.updateOnlineStatus(false);

  // Throttle sync status updates to prevent memory pressure from frequent object creation
  private syncStatusThrottleTimeout: ReturnType<typeof setTimeout> | null = null;
  private pendingSyncStatusUpdate: Partial<SyncStatus> | null = null;
  private readonly SYNC_STATUS_THROTTLE_MS = 500; // Max 2 updates per second
  private lastSyncStatusTime = 0;

  // Periodic sync restart - restart sync periodically to clear accumulated PouchDB memory
  // This is a workaround for known PouchDB memory leaks with live: true
  // See: https://github.com/pouchdb/pouchdb/issues/6502
  private syncRestartTimeout: ReturnType<typeof setTimeout> | null = null;
  private readonly SYNC_RESTART_INTERVAL_MS = 5 * 60 * 1000; // Restart sync every 5 minutes (aggressive for mobile)

  // Memory pressure detection - pause sync when memory is critically high
  private memoryPressurePaused = false;
  private memoryCheckTimeout: ReturnType<typeof setTimeout> | null = null;
  private readonly MEMORY_CHECK_INTERVAL_MS = 15 * 1000; // Check every 15 seconds
  private readonly MEMORY_PRESSURE_THRESHOLD = 0.85; // 85% heap usage triggers pause

  // Page visibility sync trigger - restart sync when user returns to app/tab
  // This is a lightweight alternative to idle detection that doesn't cause memory issues
  private handleVisibilityChange = () => this.onVisibilityChange();
  private visibilityDebounceTimeout: ReturnType<typeof setTimeout> | null = null;
  private readonly VISIBILITY_DEBOUNCE_MS = 1000; // 1 second debounce for rapid tab switches

  public syncStatus$: Observable<SyncStatus> = this.syncStatusSubject.asObservable();

  /**
   * Check if user is in local-only mode (no sync)
   */
  private isLocalOnlyMode(): boolean {
    return localStorage.getItem('creative-writer-local-only') === 'true';
  }

  // Debug sync pause handler
  private handleDebugSyncToggle = (event: Event) => {
    const customEvent = event as CustomEvent<{ paused: boolean }>;
    if (customEvent.detail.paused) {
      console.info('[DatabaseService] Debug sync pause activated - stopping sync');
      this.stopSync();
    } else {
      console.info('[DatabaseService] Debug sync pause deactivated - resuming sync');
      if (this.remoteDb && !this.syncPaused) {
        this.startSync();
      }
    }
  };

  constructor() {
    // Use preloaded PouchDB from app.ts
    this.pouchdbCtor = PouchDB as unknown as PouchDBStatic;

    // Initialize with default database (will be updated when user logs in)
    this.initializationPromise = this.initializeDatabase('creative-writer-stories');

    // Subscribe to user changes to switch databases
    this.authService.currentUser$.subscribe(user => {
      this.handleUserChange(user);
    });

    // Setup online/offline detection
    window.addEventListener('online', this.handleOnline);
    window.addEventListener('offline', this.handleOffline);

    // Setup memory pressure detection
    this.startMemoryPressureCheck();

    // Listen for debug sync toggle from MobileDebugService
    window.addEventListener('debug-sync-toggle', this.handleDebugSyncToggle);

    // Setup page visibility sync trigger - restart sync when returning to app
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
  }

  /**
   * Gracefully clean up sync handler to avoid memory spikes on mobile.
   * Staggers cleanup operations with delays to allow garbage collection.
   */
  private gracefulSyncCleanup(): void {
    if (!this.syncHandler) {
      return;
    }

    const handler = this.syncHandler;
    this.syncHandler = null;

    // Update sync status first
    this.updateSyncStatusImmediate({ isSync: false });

    // Use requestIdleCallback if available for smoother cleanup
    const scheduleCleanup = (callback: () => void, delay: number) => {
      if ('requestIdleCallback' in window) {
        (window as Window & { requestIdleCallback: (cb: () => void) => void })
          .requestIdleCallback(() => setTimeout(callback, delay));
      } else {
        setTimeout(callback, delay);
      }
    };

    // Cancel sync with a small delay to allow pending operations to complete
    // PouchDB handles listener cleanup internally when cancel() is called
    scheduleCleanup(() => {
      try {
        handler.cancel();
      } catch (e) {
        console.warn('Error canceling sync during graceful cleanup:', e);
      }
    }, 100);
  }

  /**
   * Start periodic memory pressure checking.
   * Pauses sync when JS heap usage exceeds threshold to prevent crashes.
   */
  private startMemoryPressureCheck(): void {
    if (this.memoryCheckTimeout) {
      clearTimeout(this.memoryCheckTimeout);
    }

    this.memoryCheckTimeout = setTimeout(() => {
      this.checkMemoryPressure();
    }, this.MEMORY_CHECK_INTERVAL_MS);
  }

  /**
   * Check current memory pressure and pause sync if needed.
   */
  private checkMemoryPressure(): void {
    const memoryInfo = this.getMemoryInfo();

    if (memoryInfo) {
      const usageRatio = memoryInfo.usedJSHeapSize / memoryInfo.jsHeapSizeLimit;

      if (usageRatio >= this.MEMORY_PRESSURE_THRESHOLD && !this.memoryPressurePaused && this.syncHandler) {
        console.warn(`[DatabaseService] Memory pressure detected (${(usageRatio * 100).toFixed(1)}%), pausing sync`);
        this.memoryPressurePaused = true;
        this.gracefulSyncCleanup();
      } else if (usageRatio < this.MEMORY_PRESSURE_THRESHOLD * 0.9 && this.memoryPressurePaused) {
        // Resume when memory drops below 90% of threshold (hysteresis)
        console.info(`[DatabaseService] Memory pressure relieved (${(usageRatio * 100).toFixed(1)}%), resuming sync`);
        this.memoryPressurePaused = false;
        if (this.remoteDb && !this.syncPaused) {
          this.startSync();
        }
      }
    }

    // Schedule next check
    this.startMemoryPressureCheck();
  }

  /**
   * Get JS heap memory info (Chrome/Edge only).
   */
  private getMemoryInfo(): { usedJSHeapSize: number; jsHeapSizeLimit: number } | null {
    const performance = window.performance as Performance & {
      memory?: {
        usedJSHeapSize: number;
        totalJSHeapSize: number;
        jsHeapSizeLimit: number;
      };
    };

    if (performance.memory) {
      return {
        usedJSHeapSize: performance.memory.usedJSHeapSize,
        jsHeapSizeLimit: performance.memory.jsHeapSizeLimit
      };
    }

    return null;
  }

  /**
   * Clean up memory pressure check resources.
   */
  private cleanupMemoryPressureCheck(): void {
    if (this.memoryCheckTimeout) {
      clearTimeout(this.memoryCheckTimeout);
      this.memoryCheckTimeout = null;
    }
  }

  /**
   * Handle page visibility changes.
   * Triggers sync restart when user returns to the app/tab.
   *
   * Unlike the removed idle detection, this does NOT pause sync when hidden
   * to avoid the graceful cleanup that caused mobile crashes.
   */
  private onVisibilityChange(): void {
    // Only act when page becomes visible (not when hiding)
    if (document.hidden) {
      return;
    }

    // Debounce rapid visibility changes (e.g., quick tab switches)
    if (this.visibilityDebounceTimeout) {
      clearTimeout(this.visibilityDebounceTimeout);
    }

    this.visibilityDebounceTimeout = setTimeout(() => {
      this.visibilityDebounceTimeout = null;

      // Only restart sync if:
      // 1. Not already syncing
      // 2. Not paused (by AI streaming, etc.)
      // 3. Not in memory pressure state
      // 4. Have a remote database connection
      if (!this.syncHandler && !this.syncPaused && !this.memoryPressurePaused && this.remoteDb) {
        console.info('[DatabaseService] Page visible, starting sync');
        try {
          this.startSync();
        } catch (error) {
          console.error('[DatabaseService] Failed to start sync on visibility change:', error);
        }
      } else if (this.syncHandler) {
        console.debug('[DatabaseService] Page visible, sync already active');
      }
    }, this.VISIBILITY_DEBOUNCE_MS);
  }

  /**
   * Clean up visibility change listener and debounce timeout.
   */
  private cleanupVisibilityListener(): void {
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    if (this.visibilityDebounceTimeout) {
      clearTimeout(this.visibilityDebounceTimeout);
      this.visibilityDebounceTimeout = null;
    }
  }

  private async initializeDatabase(dbName: string): Promise<void> {
    // PouchDB is now preloaded in app.ts, no need for dynamic imports
    if (!this.pouchdbCtor) {
      throw new Error('PouchDB not preloaded - check app.ts initialization');
    }

    // Stop sync first
    await this.stopSync();
    
    // Close existing database safely
    if (this.db) {
      try {
        await this.db.close();
      } catch (error) {
        console.warn('Error closing database:', error);
      }
    }

    this.db = new this.pouchdbCtor(dbName, { auto_compaction: true });

    // Clean up old mrview databases in background (don't block initialization)
    // This frees up IndexedDB storage without affecting user data
    this.cleanupOldDatabases().catch(err => {
      console.warn('[DatabaseService] Background cleanup failed:', err);
    });

    // Increase EventEmitter limit to prevent memory leak warnings
    // PouchDB sync operations create many internal event listeners
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (this.db && (this.db as any).setMaxListeners) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this.db as any).setMaxListeners(20);
    }

    // Create minimal indexes for non-story documents only
    // Stories use allDocs() which is faster for small datasets
    const indexes = [
      // Indexes for non-story documents (codex, video, etc.)
      { fields: ['type'] },
      { fields: ['storyId'] },
      // Compound index for story media (images, videos) queries by type+storyId
      { fields: ['type', 'storyId'] }
    ];

    // Store reference to current db to prevent race conditions
    const currentDb = this.db;

    // Create indexes in background - don't block database availability
    // This prevents slow index creation from delaying app startup
    Promise.all(
      indexes.map(async (indexDef) => {
        try {
          // Only create index if this database instance is still active
          if (currentDb === this.db) {
            await currentDb.createIndex({ index: indexDef });
          }
        } catch (err) {
          // Ignore errors if database was closed during initialization
          if (err && typeof err === 'object' && 'message' in err &&
              !(err.message as string).includes('database is closed')) {
            console.warn(`Could not create index for ${JSON.stringify(indexDef.fields)}:`, err);
          }
        }
      })
    ).then(() => {
      // Index creation completed
    }).catch(err => {
      console.warn('[DatabaseService] Index creation failed:', err);
    });

    // NOTE: We no longer call setupSync() here automatically.
    // Sync is now only initialized after user makes a choice (login or local-only)
    // via the initializeSync() method called from handleUserChange().
    // This prevents unauthorized sync attempts before authentication.
  }

  private async handleUserChange(user: User | null): Promise<void> {
    // Immediately switch database when user changes (no setTimeout to avoid race conditions)
    if (user) {
      const userDbName = this.authService.getUserDatabaseName();
      if (userDbName && userDbName !== (this.db?.name)) {
        // Reset sync flag when switching databases to ensure fresh sync setup
        this.syncInitialized = false;

        this.initializationPromise = this.initializeDatabase(userDbName);
        await this.initializationPromise;

        // Initialize sync after database switch (respects local-only mode)
        this.initializeSync().catch(err => {
          console.warn('[DatabaseService] Sync setup failed:', err);
        });
      }
    } else {
      // User logged out - switch to anonymous database
      const anonymousDb = 'creative-writer-stories-anonymous';
      if (this.db?.name !== anonymousDb) {
        this.initializationPromise = this.initializeDatabase(anonymousDb);
        await this.initializationPromise;

        // Stop sync and reset flag when logged out
        this.stopSync();
        this.syncInitialized = false;
      }
    }
  }

  /**
   * Initialize sync connection (called after user login/choice)
   * Does NOT start sync in local-only mode
   */
  async initializeSync(): Promise<void> {
    if (this.syncInitialized) {
      console.debug('[DatabaseService] Sync already initialized');
      return;
    }

    if (this.isLocalOnlyMode()) {
      console.info('[DatabaseService] Local-only mode - skipping sync setup');
      this.syncInitialized = true;
      return;
    }

    this.syncInitialized = true;
    await this.setupSync();
  }

  async getDatabase(): Promise<PouchDB.Database> {
    // Wait for initialization to complete
    if (this.initializationPromise) {
      await this.initializationPromise;
    }
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    return this.db;
  }

  // Synchronous getter for backwards compatibility (use with caution)
  getDatabaseSync(): PouchDB.Database | null {
    return this.db;
  }

  /**
   * Get the remote database instance (if connected)
   * Returns null if not connected to remote
   */
  getRemoteDatabase(): PouchDB.Database | null {
    return this.remoteDb;
  }

  /**
   * Set the active story ID for selective sync.
   * Only the active story and its related documents will be synced.
   * Set to null to sync all documents (frontpage).
   *
   * This method is async to ensure sync operations complete sequentially,
   * preventing concurrent sync operations that can cause memory pressure on mobile.
   */
  async setActiveStoryId(storyId: string | null): Promise<void> {
    const changed = this.activeStoryId !== storyId;
    const previousId = this.activeStoryId;
    this.activeStoryId = storyId;

    console.info(`[DatabaseService] setActiveStoryId: ${previousId} → ${storyId} (changed: ${changed})`);

    // If the active story changed and sync is running, restart sync to apply new filter
    if (changed && this.syncHandler) {
      console.info('[DatabaseService] Restarting sync to apply new activeStoryId filter...');
      try {
        await this.stopSync();  // WAIT for stop to complete before starting new sync
        console.info('[DatabaseService] Sync stopped, starting with new filter...');
        this.startSync();
        console.info('[DatabaseService] Sync restarted with activeStoryId:', this.activeStoryId);
      } catch (error) {
        console.error('[DatabaseService] Error restarting sync:', error);
        // Attempt to start sync anyway if it's not running
        if (!this.syncHandler && this.remoteDb && !this.syncPaused) {
          try {
            this.startSync();
          } catch (startError) {
            console.error('[DatabaseService] Failed to recover sync:', startError);
          }
        }
      }
    } else if (changed && !this.syncHandler && storyId && this.remoteDb) {
      // Sync not running yet - start it now that we have an active story
      console.info('[DatabaseService] Starting sync for newly selected story:', storyId);
      try {
        this.startSync();
      } catch (error) {
        console.error('[DatabaseService] Failed to start sync for story:', error);
      }
    }
  }

  /**
   * Get the currently active story ID for selective sync
   */
  getActiveStoryId(): string | null {
    return this.activeStoryId;
  }

  /**
   * Force replication of a specific document from remote
   * This is useful when opening a story to ensure it's immediately pulled from remote.
   *
   * IMPORTANT: This method serializes with main sync to prevent concurrent operations.
   * It stops the main sync, performs the replication, then restarts sync.
   *
   * @param docId The document ID to replicate
   * @returns true if document was replicated or already in sync locally, false if not found
   */
  async forceReplicateDocument(docId: string): Promise<boolean> {
    if (!this.remoteDb || !this.db) {
      console.warn('[DatabaseService] Cannot force replicate: database not initialized');
      return false;
    }

    console.info(`[DatabaseService] Force replicating document: ${docId}`);

    // Determine if this is a story document for logging
    const isStory = !docId.includes('_') || docId.startsWith('story-');
    const storyIds = isStory ? [docId] : undefined;

    // Log sync start
    const logId = this.syncLogger.logSync('download', `Syncing ${isStory ? 'story' : 'document'}`, docId, {
      storyIds,
      status: 'info'
    });

    // SERIALIZE: Stop main sync to prevent concurrent operations
    const wasRunning = !!this.syncHandler;
    if (wasRunning) {
      console.info('[DatabaseService] Pausing main sync for force replication');
      await this.stopSync();
    }

    try {
      // Do a one-time pull replication for this specific document
      // MEMORY OPTIMIZATION: return_docs: false prevents caching in memory
      const replicateOptions = {
        doc_ids: [docId],
        timeout: 10000,
        return_docs: false
      };
      const result = await this.db.replicate.from(
        this.remoteDb,
        replicateOptions as PouchDB.Replication.ReplicateOptions
      );

      // Check if any documents were actually synced
      // PouchDB replication succeeds even if document doesn't exist - it just syncs nothing
      const docsWritten = (result as { docs_written?: number }).docs_written ?? 0;
      if (docsWritten === 0) {
        // docs_written === 0 is ambiguous: document may not exist on remote,
        // or it may already be up-to-date locally. Check local existence
        // using allDocs (metadata-only) to avoid loading full doc into memory.
        const localCheck = await this.db.allDocs({ keys: [docId] });
        const existsLocally = localCheck.rows.length > 0 && !('error' in localCheck.rows[0]);
        if (existsLocally) {
          console.info(`[DatabaseService] Document ${docId} already in sync (0 new docs written)`);
          this.syncLogger.updateLog(logId, {
            status: 'success',
            action: `${isStory ? 'Story' : 'Document'} already in sync`
          });
          return true;
        } else {
          console.warn(`[DatabaseService] Document ${docId} not found on remote or locally`);
          this.syncLogger.updateLog(logId, {
            type: 'info',
            status: 'warning',
            action: `${isStory ? 'Story' : 'Document'} not found on remote`
          });
          return false;
        }
      }

      console.info(`[DatabaseService] ✓ Successfully replicated document: ${docId} (${docsWritten} docs)`);

      // VERIFY: Ensure document is readable after replication
      // IndexedDB writes can be async; verify with retry to ensure consistency
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await this.db.get(docId);
          console.info(`[DatabaseService] ✓ Document ${docId} verified readable (attempt ${attempt})`);
          break;
        } catch (verifyError) {
          if (attempt === 3) {
            console.error(`[DatabaseService] ✗ Document ${docId} not readable after replication!`, verifyError);
            // Don't fail the operation - the document was written, it just may take time to be readable
            // The caller should handle this scenario with their own retry logic
          } else {
            // Wait with exponential backoff before retry
            await new Promise(r => setTimeout(r, 100 * attempt));
          }
        }
      }

      // Update log with success
      this.syncLogger.updateLog(logId, {
        status: 'success',
        action: `Synced ${isStory ? 'story' : 'document'}`
      });
      return true;
    } catch (error) {
      console.error(`[DatabaseService] Failed to replicate document ${docId}:`, error);
      // Update log with error
      this.syncLogger.updateLog(logId, {
        type: 'error',
        status: 'error',
        action: `Failed to sync ${isStory ? 'story' : 'document'}`,
        details: error instanceof Error ? error.message : String(error)
      });
      throw error;
    } finally {
      // SERIALIZE: Restart main sync after replication completes
      if (wasRunning && this.remoteDb && !this.syncPaused) {
        // Small delay to ensure IndexedDB persistence is complete before sync restart
        // This prevents the restarted sync from interfering with the just-written document
        await new Promise(resolve => setTimeout(resolve, 100));
        console.info('[DatabaseService] Resuming main sync after force replication');
        try {
          this.startSync();
        } catch (error) {
          console.error('[DatabaseService] Failed to resume sync after force replication:', error);
        }
      }
    }
  }

  /**
   * Force replication of all images for a specific story from remote.
   * Uses allDocs with startkey/endkey to find image document IDs, then replicates them.
   *
   * @param storyId The story ID to replicate images for
   * @returns Promise that resolves when replication completes
   */
  async forceReplicateStoryImages(storyId: string): Promise<void> {
    if (!this.remoteDb || !this.db) {
      console.warn('[DatabaseService] Cannot force replicate images: database not initialized');
      return;
    }

    const prefix = `story-image_${storyId}_`;
    console.info(`[DatabaseService] Force replicating images for story: ${storyId}`);

    // Log sync start
    const logId = this.syncLogger.logSync('download', 'Syncing story images', storyId, {
      storyIds: [storyId],
      status: 'info'
    });

    // SERIALIZE: Stop main sync to prevent concurrent operations
    const wasRunning = !!this.syncHandler;
    if (wasRunning) {
      console.info('[DatabaseService] Pausing main sync for image replication');
      await this.stopSync();
    }

    try {
      // Query remote for image document IDs using allDocs with prefix range
      const remoteResult = await this.remoteDb.allDocs({
        startkey: prefix,
        endkey: prefix + '\uffff',
        include_docs: false  // Just get IDs, not full docs
      });

      const imageDocIds = remoteResult.rows.map(row => row.id);

      if (imageDocIds.length === 0) {
        console.info(`[DatabaseService] No images found for story ${storyId}`);
        // Update log - no images to sync
        this.syncLogger.updateLog(logId, {
          status: 'success',
          action: 'No images to sync'
        });
        return;
      }

      console.info(`[DatabaseService] Found ${imageDocIds.length} images to replicate`);

      // Replicate all image documents in one operation
      const replicateOptions = {
        doc_ids: imageDocIds,
        timeout: 30000,  // Longer timeout for images with attachments
        return_docs: false
      };

      await this.db.replicate.from(
        this.remoteDb,
        replicateOptions as PouchDB.Replication.ReplicateOptions
      );

      console.info(`[DatabaseService] ✓ Successfully replicated ${imageDocIds.length} images`);

      // Update log with success
      this.syncLogger.updateLog(logId, {
        status: 'success',
        action: `Synced ${imageDocIds.length} image${imageDocIds.length === 1 ? '' : 's'}`,
        itemCount: imageDocIds.length
      });
    } catch (error) {
      console.error(`[DatabaseService] Failed to replicate images for story ${storyId}:`, error);
      // Update log with error
      this.syncLogger.updateLog(logId, {
        type: 'error',
        status: 'error',
        action: 'Failed to sync images',
        details: error instanceof Error ? error.message : String(error)
      });
      // Don't throw - images failing to sync shouldn't block story loading
      // They'll sync via live sync eventually
    } finally {
      // Restart sync if it was running
      if (wasRunning && !this.syncPaused && !this.memoryPressurePaused) {
        console.info('[DatabaseService] Resuming main sync after image replication');
        try {
          this.startSync();
        } catch (error) {
          console.error('[DatabaseService] Failed to resume sync after image replication:', error);
        }
      }
    }
  }

  async setupSync(remoteUrl?: string): Promise<void> {
    // Don't setup sync in local-only mode
    if (this.isLocalOnlyMode()) {
      console.info('[DatabaseService] Local-only mode enabled - sync disabled');
      return;
    }

    try {
      // Use provided URL or try to detect from environment/location
      const couchUrl = remoteUrl || this.getCouchDBUrl();

      if (!couchUrl) {
        return;
      }

      // Indicate that we're connecting
      this.updateSyncStatus({
        isConnecting: true,
        error: undefined
      });

      const Pouch = this.pouchdbCtor;
      if (!Pouch) {
        throw new Error('PouchDB not initialized');
      }
      this.remoteDb = new Pouch(couchUrl, {
        auth: {
          username: 'admin',
          password: 'password' // TODO: Make this configurable
        }
      });

      // Test connection
      try {
        await this.remoteDb.info();
      } catch (testError) {
        // If info() fails, likely the CouchDB server is not available or returns HTML error page
        // Clean up the remoteDb reference and throw a more user-friendly error
        this.remoteDb = null;
        throw new Error(`CouchDB connection failed: ${testError instanceof Error ? testError.message : String(testError)}`);
      }

      // Connection successful, clear connecting state
      this.updateSyncStatus({ isConnecting: false });

      // Note: We don't start full sync here anymore.
      // - Metadata index is queried directly from remote by StoryMetadataIndexService
      // - Full sync only starts when user selects a story (setActiveStoryId)
      // - Bootstrap sync is triggered if needed when metadata index is missing

    } catch (error) {
      console.warn('Could not setup sync:', error);
      this.remoteDb = null;

      const errorMessage = this.getFriendlySyncError(error, 'Sync setup failed');
      this.updateSyncStatus({
        error: errorMessage,
        isConnecting: false
      });
    }
  }

  private getCouchDBUrl(): string | null {
    // Get the current database name (user-specific)
    const dbName = this.db ? this.db.name : 'creative-writer-stories-anonymous';

    // Use environment-configured URL if available
    if (environment.couchDbBaseUrl) {
      return `${environment.couchDbBaseUrl}/${dbName}`;
    }

    // Try to determine CouchDB URL based on current location
    const hostname = window.location.hostname;
    const protocol = window.location.protocol;
    const port = window.location.port;

    // Check if we're running with nginx reverse proxy (through /_db/ path)
    const baseUrl = port ? `${protocol}//${hostname}:${port}` : `${protocol}//${hostname}`;

    // For development with direct CouchDB access
    if ((hostname === 'localhost' || hostname === '127.0.0.1') && !this.isReverseProxySetup()) {
      return `${protocol}//${hostname}:5984/${dbName}`;
    }

    // For production or reverse proxy setup - use /_db/ prefix
    return `${baseUrl}/_db/${dbName}`;
  }

  private isReverseProxySetup(): boolean {
    // Check if we can detect reverse proxy setup by testing for nginx-specific headers
    // or by checking if the current port is not 5984 (standard CouchDB port)
    const port = window.location.port;
    // If running on port 3080 (nginx proxy port) or any non-5984 port, assume reverse proxy
    return port === '3080' || (port !== '5984' && port !== '');
  }

  /**
   * Returns the selective sync filter function.
   *
   * BLACKLIST APPROACH: Instead of whitelisting specific document types,
   * we identify story-specific documents by their properties and exclude them
   * when appropriate. This makes the filter future-proof for new document types.
   *
   * Story-specific documents are identified by:
   * 1. Having a `storyId` field (codex, scene-chat, story-research, character-chat, etc.)
   * 2. Being a story document itself (has `chapters` field)
   *
   * All other documents sync by default, ensuring new features work automatically.
   */
  private getSyncFilter(): (doc: PouchDB.Core.Document<Record<string, unknown>>) => boolean {
    return (doc: PouchDB.Core.Document<Record<string, unknown>>) => {
      const docId = doc._id;
      const docType = (doc as { type?: string }).type;
      const storyId = (doc as { storyId?: string }).storyId;
      const hasChapters = 'chapters' in doc;

      // ═══════════════════════════════════════════════════════════════════════
      // ALWAYS EXCLUDE: Snapshots are too large, handled separately
      // ═══════════════════════════════════════════════════════════════════════
      if (docType === 'story-snapshot') {
        return false;
      }

      // ═══════════════════════════════════════════════════════════════════════
      // FRONTPAGE ONLY: Metadata index syncs only when no active story
      // ═══════════════════════════════════════════════════════════════════════

      // Story metadata index - only sync on frontpage (no active story)
      // In story editor, metadata changes are written locally and sync when returning to frontpage
      if (docId === 'story-metadata-index' || docType === 'story-metadata-index') {
        return !this.activeStoryId;  // Only sync on frontpage
      }

      // Design documents (CouchDB indexes) and local documents
      if (docId.startsWith('_')) {
        return true;
      }

      // ═══════════════════════════════════════════════════════════════════════
      // SELECTIVE SYNC: Filter story-specific documents
      // ═══════════════════════════════════════════════════════════════════════

      // Check if this is a story document (has chapters field)
      if (hasChapters) {
        return this.activeStoryId ? docId === this.activeStoryId : false;
      }

      // Check if this is a story-specific document (has non-empty storyId field)
      if (storyId && typeof storyId === 'string' && storyId.length > 0) {
        return this.activeStoryId ? storyId === this.activeStoryId : false;
      }

      // ═══════════════════════════════════════════════════════════════════════
      // DEFAULT: Sync all other documents (user-wide resources, new doc types)
      // ═══════════════════════════════════════════════════════════════════════
      return true;
    };
  }

  private startSync(): void {
    if (!this.remoteDb || !this.db) return;

    // Check for debug sync pause (for debugging memory issues)
    if (localStorage.getItem('debug_sync_paused') === 'true') {
      console.info('[DatabaseService] Sync blocked by debug pause');
      return;
    }

    // SYNC GUARD: Clean up existing handler first to prevent orphaned sync operations
    // This ensures only ONE sync operation runs at any time
    if (this.syncHandler) {
      console.info('[DatabaseService] Cleaning up existing sync handler before starting new one');
      const handlerToCleanup = this.syncHandler;
      this.syncHandler = null; // Clear reference immediately to prevent re-entry

      try {
        // Cancel the sync - PouchDB handles listener cleanup internally
        handlerToCleanup.cancel();
      } catch (error) {
        console.warn('[DatabaseService] Error cleaning up existing sync handler:', error);
      }
    }

    // MEMORY OPTIMIZATION options for mobile devices
    // These are official PouchDB options but missing from @types/pouchdb
    // See: https://pouchdb.com/api.html#replication
    const syncOptions = {
      live: true,
      retry: true,
      timeout: 30000,
      // Prevent PouchDB from caching synced documents in memory
      // Critical for mobile to prevent browser crashes
      // See: https://github.com/pouchdb/pouchdb/issues/6502
      return_docs: false,
      // Limit batch size to prevent memory spikes (default: 100)
      // Reduced to 10 for aggressive mobile memory optimization
      batch_size: 10,
      // Limit concurrent batches to cap memory usage (default: 10)
      // Reduced to 1 for aggressive mobile memory optimization
      batches_limit: 1,
      // SELECTIVE SYNC: Filter to only sync active story and related documents
      // Note: Filter only works for PULL, not PUSH. Push is handled manually.
      filter: this.getSyncFilter()
    };

    const handler = this.db.sync(
      this.remoteDb,
      syncOptions as PouchDB.Replication.SyncOptions
    ) as unknown as PouchSync;

    this.syncHandler = handler
    .on('change', (info: unknown) => {
      // Extract document details from change event
      let docsProcessed = 0;
      let currentDoc = undefined;
      let operation: 'push' | 'pull' = 'pull';

      if (info && typeof info === 'object') {
        // Check if this is a push or pull operation
        if ('direction' in info && info.direction === 'push') {
          operation = 'push';
        }

        // Extract documents information
        if ('change' in info && info.change && typeof info.change === 'object') {
          const change = info.change as { docs?: unknown[] };
          if (change.docs && Array.isArray(change.docs)) {
            docsProcessed = change.docs.length;

            // Get the last document details
            if (change.docs.length > 0) {
              const lastDoc = change.docs[change.docs.length - 1];
              if (lastDoc && typeof lastDoc === 'object' && '_id' in lastDoc) {
                currentDoc = {
                  id: (lastDoc as { _id: string })._id,
                  type: 'type' in lastDoc ? String((lastDoc as { type: unknown }).type) : undefined,
                  title: 'title' in lastDoc ? String((lastDoc as { title: unknown }).title) : undefined
                };
              }
            }
          }
        }
      }

      // Update progress only - DO NOT set isSync: false or lastSync here!
      // Those should only be set in the 'paused' handler when sync is truly complete.
      // Setting them here caused the green "synced" badge to appear prematurely.
      this.updateSyncStatus({
        error: undefined,
        syncProgress: docsProcessed > 0 ? {
          docsProcessed,
          operation,
          currentDoc
        } : undefined
      });
    })
    .on('active', (info: unknown) => {
      // Extract pending count if available
      let pendingDocs = undefined;

      if (info && typeof info === 'object' && 'pending' in info) {
        pendingDocs = typeof info.pending === 'number' ? info.pending : undefined;
      }

      this.updateSyncStatus({
        isSync: true,
        error: undefined,
        syncProgress: pendingDocs !== undefined ? {
          docsProcessed: 0,
          operation: 'pull',
          pendingDocs
        } : undefined
      });
    })
    .on('paused', () => {
      // Paused event means sync caught up and is waiting for new changes
      // This is the ONLY place where lastSync should be set - indicates true sync completion
      this.updateSyncStatus({
        isSync: false,
        lastSync: new Date(),
        syncProgress: undefined
      });
    })
    .on('error', (info: unknown) => {
      console.error('Sync error:', info);
      this.updateSyncStatus({
        isSync: false,
        error: `Sync error: ${info}`,
        syncProgress: undefined
      });
    });

    // Schedule periodic sync restart to clear accumulated PouchDB memory
    // This is a workaround for PouchDB memory leaks with live: true
    this.scheduleSyncRestart();
  }

  /**
   * Schedule a periodic sync restart to clear accumulated memory.
   * PouchDB live sync can accumulate internal state over time, causing memory pressure.
   */
  private scheduleSyncRestart(): void {
    // Clear any existing restart timeout
    if (this.syncRestartTimeout) {
      clearTimeout(this.syncRestartTimeout);
      this.syncRestartTimeout = null;
    }

    this.syncRestartTimeout = setTimeout(async () => {
      // Only restart if sync is actually running and not paused
      if (this.syncHandler && !this.syncPaused) {
        console.info('[DatabaseService] Periodic sync restart to clear memory');

        try {
          await this.stopSync();
          // Small delay to allow garbage collection (best effort)
          await new Promise(resolve => setTimeout(resolve, 100));
          // Recheck state after delay - may have changed
          if (this.remoteDb && !this.syncPaused) {
            this.startSync(); // startSync() calls scheduleSyncRestart()
          }
        } catch (err) {
          console.warn('[DatabaseService] Error during periodic sync restart:', err);
          // Reschedule even on error to maintain periodic restarts
          this.scheduleSyncRestart();
        }
      } else {
        // Sync not running or paused - reschedule for later
        this.scheduleSyncRestart();
      }
    }, this.SYNC_RESTART_INTERVAL_MS);
  }

  private updateOnlineStatus(isOnline: boolean): void {
    // Online status changes should be immediate (not throttled)
    this.updateSyncStatusImmediate({ isOnline });
  }

  /**
   * Throttled sync status update to prevent memory pressure from rapid updates.
   * Merges pending updates and emits at most once per SYNC_STATUS_THROTTLE_MS.
   */
  private updateSyncStatus(updates: Partial<SyncStatus>): void {
    const now = Date.now();
    const timeSinceLastUpdate = now - this.lastSyncStatusTime;

    // Merge with any pending updates
    this.pendingSyncStatusUpdate = {
      ...this.pendingSyncStatusUpdate,
      ...updates
    };

    // If enough time has passed, emit immediately
    if (timeSinceLastUpdate >= this.SYNC_STATUS_THROTTLE_MS) {
      this.flushSyncStatusUpdate();
      return;
    }

    // Otherwise, schedule a delayed update if not already scheduled
    if (!this.syncStatusThrottleTimeout) {
      this.syncStatusThrottleTimeout = setTimeout(() => {
        this.flushSyncStatusUpdate();
      }, this.SYNC_STATUS_THROTTLE_MS - timeSinceLastUpdate);
    }
  }

  /**
   * Immediate sync status update (bypasses throttling).
   * Use for critical state changes like online/offline status.
   */
  private updateSyncStatusImmediate(updates: Partial<SyncStatus>): void {
    // Clear any pending throttled update
    if (this.syncStatusThrottleTimeout) {
      clearTimeout(this.syncStatusThrottleTimeout);
      this.syncStatusThrottleTimeout = null;
    }

    // Merge pending updates with new updates
    const mergedUpdates = {
      ...this.pendingSyncStatusUpdate,
      ...updates
    };
    this.pendingSyncStatusUpdate = null;

    const current = this.syncStatusSubject.value;
    this.syncStatusSubject.next({ ...current, ...mergedUpdates });
    this.lastSyncStatusTime = Date.now();
  }

  private flushSyncStatusUpdate(): void {
    if (this.syncStatusThrottleTimeout) {
      clearTimeout(this.syncStatusThrottleTimeout);
      this.syncStatusThrottleTimeout = null;
    }

    if (this.pendingSyncStatusUpdate) {
      const current = this.syncStatusSubject.value;
      this.syncStatusSubject.next({ ...current, ...this.pendingSyncStatusUpdate });
      this.pendingSyncStatusUpdate = null;
      this.lastSyncStatusTime = Date.now();
    }
  }

  async stopSync(): Promise<void> {
    // Clear periodic restart timeout
    if (this.syncRestartTimeout) {
      clearTimeout(this.syncRestartTimeout);
      this.syncRestartTimeout = null;
    }

    if (this.syncHandler) {
      try {
        // Cancel the sync - PouchDB handles listener cleanup internally
        this.syncHandler.cancel();
      } catch (error) {
        console.warn('Error canceling sync:', error);
      }
      this.syncHandler = null;
    }
    this.updateSyncStatus({ isSync: false });
  }

  /**
   * Temporarily pause database sync during performance-critical operations
   * like AI text streaming. Uses a counter to support nested pause/resume calls.
   * Safe to call multiple times - sync only resumes when all pausers have resumed.
   */
  pauseSync(): void {
    this.activePauseCount++;

    if (this.syncHandler && !this.syncPaused) {
      console.info('[DatabaseService] Pausing sync for performance-critical operation');
      try {
        this.syncHandler.cancel();
      } catch (error) {
        console.warn('Error pausing sync:', error);
      }
      this.syncHandler = null;
      this.syncPaused = true;
    }
  }

  /**
   * Resume database sync after a performance-critical operation completes.
   * Only actually resumes when all nested pause calls have been matched with resume calls.
   */
  resumeSync(): void {
    if (this.activePauseCount > 0) {
      this.activePauseCount--;
    }

    // Only resume if all pausers have resumed and sync was actually paused
    if (this.activePauseCount === 0 && this.syncPaused && this.remoteDb) {
      console.info('[DatabaseService] Resuming sync after performance-critical operation');
      this.syncPaused = false;
      this.startSync();
    }
  }

  async forcePush(): Promise<{ docsProcessed: number }> {
    return await this.runManualReplication('push');
  }

  async forcePull(): Promise<{ docsProcessed: number }> {
    return await this.runManualReplication('pull');
  }

  /**
   * Push specific documents by their IDs to the remote database.
   * More reliable than forcePush() with filters for known document IDs.
   */
  async pushDocuments(docIds: string[]): Promise<{ docsProcessed: number }> {
    if (!this.remoteDb || !this.db) {
      console.debug('[DatabaseService] pushDocuments: Remote database not connected');
      return { docsProcessed: 0 };
    }

    if (docIds.length === 0) {
      return { docsProcessed: 0 };
    }

    console.info(`[DatabaseService] Pushing ${docIds.length} document(s): ${docIds.join(', ')}`);

    try {
      // MEMORY OPTIMIZATION: return_docs: false prevents caching in memory
      const replicateOptions = {
        doc_ids: docIds,
        return_docs: false
      };
      const result = await this.db.replicate.to(
        this.remoteDb,
        replicateOptions as PouchDB.Replication.ReplicateOptions
      );

      const docsWritten = (result as { docs_written?: number }).docs_written || 0;
      console.info(`[DatabaseService] Push complete: ${docsWritten} docs written`);

      // Update sync status to show successful sync
      if (docsWritten > 0) {
        this.updateSyncStatus({
          lastSync: new Date(),
          error: undefined
        });
      }

      return { docsProcessed: docsWritten };
    } catch (err) {
      console.error('[DatabaseService] pushDocuments failed:', err);
      throw err;
    }
  }

  async compact(): Promise<void> {
    if (!this.db) return;
    await this.db.compact();
  }

  async destroy(): Promise<void> {
    // Remove window event listeners
    window.removeEventListener('online', this.handleOnline);
    window.removeEventListener('offline', this.handleOffline);
    window.removeEventListener('debug-sync-toggle', this.handleDebugSyncToggle);

    // Clean up memory pressure detection
    this.cleanupMemoryPressureCheck();

    // Clean up visibility change listener
    this.cleanupVisibilityListener();

    // Clean up sync status throttle timeout
    if (this.syncStatusThrottleTimeout) {
      clearTimeout(this.syncStatusThrottleTimeout);
      this.syncStatusThrottleTimeout = null;
    }
    this.pendingSyncStatusUpdate = null;

    await this.stopSync();
    if (!this.db) return;
    await this.db.destroy();
  }

  private async runManualReplication(direction: 'push' | 'pull'): Promise<{ docsProcessed: number }> {
    const user = this.authService.getCurrentUser();
    const userId = user?.username ?? 'anonymous';

    if (!this.remoteDb || !this.db) {
      const message = 'Remote database not connected';
      this.updateSyncStatus({ error: message });
      this.syncLogger.logError(
        direction === 'push' ? 'Manual push failed: remote database not connected' : 'Manual pull failed: remote database not connected',
        userId
      );
      throw new Error(message);
    }

    const logId = this.syncLogger.logInfo(
      direction === 'push' ? 'Manual push started' : 'Manual pull started',
      undefined,
      userId
    );

    this.updateSyncStatus({
      isSync: true,
      error: undefined,
      syncProgress: { docsProcessed: 0, operation: direction }
    });
    const startTime = Date.now();

    // Set up timeout (60 seconds)
    const timeoutMs = 60000;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let timedOut = false;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        timedOut = true;
        reject(new Error('Sync operation timed out after 60 seconds'));
      }, timeoutMs);
    });

    try {
      // Create replication with progress tracking
      const replicationPromise = (async () => {
        // If no active story, only sync story-metadata-index (server-side efficient)
        // If active story, use the client-side filter for selective sync
        // MEMORY OPTIMIZATION: Add return_docs: false and batch limits
        const baseOptions = {
          return_docs: false,
          batch_size: 10,
          batches_limit: 1
        };
        const replicationOptions = (this.activeStoryId
          ? { ...baseOptions, filter: this.getSyncFilter() }
          : { ...baseOptions, doc_ids: ['story-metadata-index'] }
        ) as PouchDB.Replication.ReplicateOptions;

        console.info(`[Sync] Force ${direction} with ${this.activeStoryId ? 'filter (active story: ' + this.activeStoryId + ')' : 'doc_ids (metadata-index only)'}`);

        const replication = direction === 'push'
          ? this.db!.replicate.to(this.remoteDb!, replicationOptions)
          : this.db!.replicate.from(this.remoteDb!, replicationOptions);

        // Track progress during replication with document details
        let totalProcessed = 0;
        (replication as PouchDB.Replication.Replication<Record<string, unknown>>)
          .on('change', (info) => {
            if (info && typeof info === 'object' && 'docs' in info) {
              const docs = info.docs as unknown[];
              const docsCount = docs?.length || 0;
              totalProcessed += docsCount;

              // Get current document details
              let currentDoc = undefined;
              if (docs && docs.length > 0) {
                const lastDoc = docs[docs.length - 1];
                if (lastDoc && typeof lastDoc === 'object' && '_id' in lastDoc) {
                  currentDoc = {
                    id: (lastDoc as { _id: string })._id,
                    type: 'type' in lastDoc ? String((lastDoc as { type: unknown }).type) : undefined,
                    title: 'title' in lastDoc ? String((lastDoc as { title: unknown }).title) : undefined
                  };
                }
              }

              // Get total docs if available
              let totalDocs: number | undefined = undefined;
              if ('docs_read' in info) {
                totalDocs = (info as { docs_read: number }).docs_read;
              } else if ('docs_written' in info) {
                totalDocs = (info as { docs_written: number }).docs_written;
              }

              this.updateSyncStatus({
                syncProgress: {
                  docsProcessed: totalProcessed,
                  totalDocs,
                  operation: direction,
                  currentDoc
                }
              });
            }
          });

        return await replication;
      })();

      // Race between replication and timeout
      const result = await Promise.race([replicationPromise, timeoutPromise]);

      if (timeoutId) clearTimeout(timeoutId);

      const duration = Date.now() - startTime;
      const itemCount = direction === 'push' ? result.docs_written : result.docs_read;

      this.updateSyncStatus({
        lastSync: new Date(),
        error: undefined,
        syncProgress: undefined
      });

      this.syncLogger.updateLog(logId, {
        type: direction === 'push' ? 'upload' : 'download',
        status: 'success',
        action: direction === 'push'
          ? `Manual push completed (${itemCount} ${itemCount === 1 ? 'doc' : 'docs'})`
          : `Manual pull completed (${itemCount} ${itemCount === 1 ? 'doc' : 'docs'})`,
        itemCount,
        duration,
        timestamp: new Date()
      });

      return { docsProcessed: itemCount };
    } catch (error) {
      if (timeoutId) clearTimeout(timeoutId);

      console.error(direction === 'push' ? 'Force push failed:' : 'Force pull failed:', error);
      const friendlyMessage = this.getFriendlySyncError(
        error,
        timedOut ? 'Sync timed out' : (direction === 'push' ? 'Manual push failed' : 'Manual pull failed')
      );

      this.updateSyncStatus({ error: friendlyMessage, syncProgress: undefined });
      this.syncLogger.updateLog(logId, {
        type: 'error',
        status: 'error',
        action: direction === 'push' ? 'Manual push failed' : 'Manual pull failed',
        details: friendlyMessage,
        timestamp: new Date()
      });

      throw error;
    } finally {
      this.updateSyncStatus({ isSync: false, syncProgress: undefined });
    }
  }

  private getFriendlySyncError(error: unknown, fallback: string): string {
    if (error instanceof Error) {
      const message = error.message;
      const normalized = message.toLowerCase();

      if (normalized.includes('couchdb connection failed') || normalized.includes('failed to fetch') || normalized.includes('network')) {
        return 'Database server unreachable';
      }
      if (normalized.includes('unauthorized') || normalized.includes('auth')) {
        return 'Database authentication failed';
      }
      if (normalized.includes('timeout')) {
        return 'Database connection timeout';
      }
      if (normalized.includes('syntaxerror') && normalized.includes('json')) {
        return 'Database server returned invalid response';
      }

      return `${fallback}: ${message}`;
    }

    if (typeof error === 'string') {
      return error;
    }

    return fallback;
  }

  /**
   * Get current database storage usage
   */
  async getDatabaseSize(): Promise<{ used: number; quota: number; percentage: number }> {
    try {
      if ('storage' in navigator && 'estimate' in navigator.storage) {
        const estimate = await navigator.storage.estimate();
        const used = estimate.usage || 0;
        const quota = estimate.quota || 0;
        const percentage = quota > 0 ? (used / quota) * 100 : 0;

        return { used, quota, percentage };
      }
    } catch (error) {
      console.warn('Could not estimate storage:', error);
    }

    return { used: 0, quota: 0, percentage: 0 };
  }

  /**
   * Check storage health and emit warnings if needed
   */
  async checkStorageHealth(): Promise<{ healthy: boolean; message?: string }> {
    const { percentage, used, quota } = await this.getDatabaseSize();

    if (percentage > 90) {
      return {
        healthy: false,
        message: `Storage almost full (${percentage.toFixed(1)}%)! Used ${this.formatBytes(used)} of ${this.formatBytes(quota)}. Consider cleaning up old data.`
      };
    } else if (percentage > 75) {
      return {
        healthy: false,
        message: `Storage usage high (${percentage.toFixed(1)}%). Used ${this.formatBytes(used)} of ${this.formatBytes(quota)}.`
      };
    }

    return { healthy: true };
  }

  /**
   * Clean up old PouchDB mrview databases from IndexedDB
   * SAFE: Only removes materialized view databases (indexes), NEVER user data
   * mrview databases can be recreated automatically by PouchDB when needed
   */
  async cleanupOldDatabases(): Promise<{ cleaned: number; kept: number; errors: string[] }> {
    const currentDbName = this.db?.name;
    const errors: string[] = [];
    let cleaned = 0;
    let kept = 0;

    try {
      // Get all databases from IndexedDB
      if (!indexedDB.databases) {
        console.warn('[DatabaseService] IndexedDB.databases() not supported, skipping cleanup');
        return { cleaned: 0, kept: 0, errors: ['IndexedDB.databases() not supported'] };
      }

      const databases = await indexedDB.databases();

      for (const dbInfo of databases) {
        const dbName = dbInfo.name;
        if (!dbName || !dbName.startsWith('_pouch_')) {
          kept++;
          continue; // Not a PouchDB database
        }

        // ONLY delete mrview databases (materialized views / indexes)
        // NEVER delete user story databases - they contain actual data!
        const isMrviewDatabase = dbName.includes('-mrview-');
        const isCurrentMrview = currentDbName && dbName.includes(`${currentDbName}-mrview-`);
        const isBeatHistoriesMrview = dbName.includes('beat-histories-mrview-');

        if (isMrviewDatabase && !isCurrentMrview && !isBeatHistoriesMrview) {
          // Safe to delete: old mrview database for inactive user database
          try {
            if (!this.pouchdbCtor) {
              throw new Error('PouchDB not initialized');
            }
            const tempDb = new this.pouchdbCtor(dbName);
            await tempDb.destroy();
            cleaned++;
          } catch (error) {
            const errorMsg = `Failed to delete ${dbName}: ${error}`;
            console.warn(`[DatabaseService] ${errorMsg}`);
            errors.push(errorMsg);
          }
        } else {
          kept++;
        }
      }
    } catch (error) {
      const errorMsg = `Database cleanup failed: ${error}`;
      console.error(`[DatabaseService] ${errorMsg}`);
      errors.push(errorMsg);
    }

    return { cleaned, kept, errors };
  }

  /**
   * Format bytes to human readable format
   */
  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  }

}
