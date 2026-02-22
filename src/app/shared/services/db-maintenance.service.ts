import { Injectable, inject } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { DatabaseService } from '../../core/services/database.service';
import { StoryService } from '../../stories/services/story.service';

export interface DatabaseStats {
  totalStories: number;
  actualSize: number;
  totalDocuments: number;
}

export interface IntegrityIssue {
  type: 'missing_chapters' | 'missing_scenes' | 'corrupt_data' | 'invalid_references';
  storyId: string;
  storyTitle: string;
  description: string;
  severity: 'low' | 'medium' | 'high';
}

export interface RemoteScanProgress {
  phase: 'fetching-stories' | 'analyzing-content' | 'complete';
  current: number;
  total: number;
  message: string;
}

@Injectable({
  providedIn: 'root'
})
export class DbMaintenanceService {
  private readonly databaseService = inject(DatabaseService);
  private readonly storyService = inject(StoryService);

  private operationProgress = new BehaviorSubject<{ operation: string; progress: number; message: string }>({
    operation: '',
    progress: 0,
    message: ''
  });

  public operationProgress$ = this.operationProgress.asObservable();

  constructor() {
    // Service initialization
  }

  private updateProgress(operation: string, progress: number, message: string): void {
    this.operationProgress.next({ operation, progress, message });
  }

  /**
   * Checks story integrity by scanning the REMOTE CouchDB database directly.
   *
   * @param progressCallback Optional callback for progress updates
   * @returns Promise<IntegrityIssue[]> List of integrity issues found
   * @throws Error if remote database is not connected
   */
  async checkStoryIntegrityFromRemote(
    progressCallback?: (progress: RemoteScanProgress) => void
  ): Promise<IntegrityIssue[]> {
    const updateProgress = (phase: RemoteScanProgress['phase'], current: number, total: number, message: string) => {
      if (progressCallback) {
        progressCallback({ phase, current, total, message });
      }
    };

    try {
      const remoteDb = this.databaseService.getRemoteDatabase();
      if (!remoteDb) {
        throw new Error('Remote database not connected. Please enable sync in Settings.');
      }

      // Phase 1: Fetch all stories from remote
      updateProgress('fetching-stories', 0, 100, 'Loading stories from remote database...');

      const allDocsResult = await remoteDb.allDocs({ include_docs: true });

      interface StoryDoc {
        _id: string;
        id?: string;
        title?: string;
        createdAt?: string;
        updatedAt?: string;
        chapters?: {
          title?: string;
          scenes?: unknown[];
        }[];
      }

      const allStories = allDocsResult.rows
        .filter(row => {
          if (!row.doc || row.id.startsWith('_')) return false;
          const doc = row.doc as StoryDoc;
          return doc.chapters && Array.isArray(doc.chapters);
        })
        .map(row => row.doc as StoryDoc);

      updateProgress('fetching-stories', 100, 100, `${allStories.length} stories found`);

      // Phase 2: Check each story for integrity issues
      updateProgress('analyzing-content', 0, allStories.length, 'Checking story integrity...');

      const issues: IntegrityIssue[] = [];
      let processedCount = 0;

      for (const story of allStories) {
        // Check for missing chapters
        if (!story.chapters || story.chapters.length === 0) {
          issues.push({
            type: 'missing_chapters',
            storyId: story.id || story._id,
            storyTitle: story.title || 'Untitled Story',
            description: 'Story has no chapters',
            severity: 'high'
          });
        } else {
          // Check each chapter for missing scenes
          for (const chapter of story.chapters) {
            if (!chapter.scenes || chapter.scenes.length === 0) {
              issues.push({
                type: 'missing_scenes',
                storyId: story.id || story._id,
                storyTitle: story.title || 'Untitled Story',
                description: `Chapter "${chapter.title || 'Untitled'}" has no scenes`,
                severity: 'medium'
              });
            }
          }
        }

        // Check for corrupt data (basic validation)
        if (!story._id || !story.createdAt || !story.updatedAt) {
          issues.push({
            type: 'corrupt_data',
            storyId: story.id || story._id || 'unknown',
            storyTitle: story.title || 'Untitled Story',
            description: 'Story has missing or corrupt metadata',
            severity: 'high'
          });
        }

        processedCount++;
        updateProgress('analyzing-content', processedCount, allStories.length,
          `Checking story ${processedCount}/${allStories.length}`);
      }

      updateProgress('complete', 100, 100, `${issues.length} integrity issues found`);

      return issues;
    } catch (error) {
      console.error('Error checking story integrity from remote:', error);
      throw error;
    }
  }

  /**
   * Gets database statistics from the REMOTE CouchDB database directly.
   *
   * @param progressCallback Optional callback for progress updates
   * @returns Promise<DatabaseStats> Database statistics
   * @throws Error if remote database is not connected
   */
  async getDatabaseStatsFromRemote(
    progressCallback?: (progress: RemoteScanProgress) => void
  ): Promise<DatabaseStats> {
    const updateProgress = (phase: RemoteScanProgress['phase'], current: number, total: number, message: string) => {
      if (progressCallback) {
        progressCallback({ phase, current, total, message });
      }
    };

    try {
      const remoteDb = this.databaseService.getRemoteDatabase();
      if (!remoteDb) {
        throw new Error('Remote database not connected. Please enable sync in Settings.');
      }

      // Phase 1: Fetch all documents from remote
      updateProgress('fetching-stories', 0, 100, 'Loading database contents...');

      const allDocsResult = await remoteDb.allDocs({ include_docs: true });

      // Count stories and calculate actual size
      let storyCount = 0;
      let totalSize = 0;
      let totalDocuments = 0;

      updateProgress('analyzing-content', 0, allDocsResult.rows.length, 'Calculating document sizes...');

      let lastProgressUpdate = Date.now();
      const PROGRESS_INTERVAL = 100; // ms - time-based throttling for mobile

      for (let i = 0; i < allDocsResult.rows.length; i++) {
        const row = allDocsResult.rows[i];
        if (!row.doc || row.id.startsWith('_')) continue;

        totalDocuments++;
        // Calculate actual size of the document JSON
        totalSize += JSON.stringify(row.doc).length;

        const doc = row.doc as { chapters?: unknown[] };
        if (doc.chapters && Array.isArray(doc.chapters)) {
          storyCount++;
        }

        // Time-based progress updates with UI yielding for mobile performance
        const now = Date.now();
        if (now - lastProgressUpdate > PROGRESS_INTERVAL) {
          updateProgress('analyzing-content', i, allDocsResult.rows.length,
            `Analyzed ${i}/${allDocsResult.rows.length} documents...`);
          lastProgressUpdate = now;
          // Yield to UI thread to prevent blocking on mobile
          await new Promise(resolve => setTimeout(resolve, 0));
        }
      }

      updateProgress('complete', 100, 100, `${storyCount} stories, ${this.formatBytes(totalSize)} total`);

      return {
        totalStories: storyCount,
        actualSize: totalSize,
        totalDocuments
      };
    } catch (error) {
      console.error('Error getting database stats from remote:', error);
      throw error;
    }
  }

  /**
   * Safely gets storage estimate with feature detection
   * Returns { usage: 0, quota: 0 } if Storage API is not available
   */
  private async getStorageEstimate(): Promise<{ usage: number; quota: number }> {
    if ('storage' in navigator && 'estimate' in navigator.storage) {
      try {
        const estimate = await navigator.storage.estimate();
        return {
          usage: estimate.usage || 0,
          quota: estimate.quota || 0
        };
      } catch {
        return { usage: 0, quota: 0 };
      }
    }
    return { usage: 0, quota: 0 };
  }

  /**
   * Compacts the PouchDB database to reduce size
   * Returns actual bytes freed using navigator.storage.estimate()
   */
  async compactDatabase(): Promise<{ sizeBefore: number; sizeAfter: number; saved: number }> {
    this.updateProgress('compact', 0, 'Analyzing storage usage...');

    try {
      const db = await this.databaseService.getDatabase();

      // Get actual storage size before compaction
      const storageBefore = await this.getStorageEstimate();
      const sizeBefore = storageBefore.usage;

      if (sizeBefore > 0) {
        this.updateProgress('compact', 10, `Current usage: ${this.formatBytes(sizeBefore)}`);
      }

      this.updateProgress('compact', 20, 'Compacting database...');

      // Compact database to remove deleted document revisions
      await db.compact();

      // Try to clean up orphaned view data, but don't fail if it crashes
      // (can be memory-intensive on large databases)
      try {
        this.updateProgress('compact', 50, 'Cleaning up orphaned views...');
        await db.viewCleanup();
      } catch (viewCleanupError) {
        console.warn('viewCleanup failed (may be too memory-intensive):', viewCleanupError);
        this.updateProgress('compact', 60, 'View cleanup skipped (database too large)');
      }

      this.updateProgress('compact', 80, 'Measuring storage freed...');

      // Get actual storage size after compaction
      const storageAfter = await this.getStorageEstimate();
      const sizeAfter = storageAfter.usage;
      const saved = sizeBefore - sizeAfter;

      const message = sizeBefore > 0 && sizeAfter > 0
        ? (saved > 0
            ? `Freed ${this.formatBytes(saved)} (${this.formatBytes(sizeBefore)} → ${this.formatBytes(sizeAfter)})`
            : `Storage unchanged at ${this.formatBytes(sizeAfter)}`)
        : 'Compaction complete';

      this.updateProgress('compact', 100, message);

      return {
        sizeBefore,
        sizeAfter,
        saved
      };
    } catch (error) {
      console.error('Error compacting database:', error);
      this.updateProgress('compact', 0, 'Error compacting database');
      throw error;
    }
  }

  /**
   * Aggressively cleans storage by deleting all PouchDB index databases.
   * This is safe because indexes will be recreated automatically when needed.
   * Much more memory-efficient than compact() for very large databases.
   */
  async deepClean(): Promise<{ sizeBefore: number; sizeAfter: number; saved: number; deletedDatabases: number }> {
    this.updateProgress('rebuild', 0, 'Starting deep clean...');

    try {
      // Get storage before
      const storageBefore = await this.getStorageEstimate();
      const sizeBefore = storageBefore.usage;

      if (sizeBefore > 0) {
        this.updateProgress('rebuild', 5, `Current usage: ${this.formatBytes(sizeBefore)}`);
      }

      let deletedCount = 0;

      // Step 1: Delete all mrview (index) databases from IndexedDB
      // These can be huge and are safely recreatable
      this.updateProgress('rebuild', 10, 'Finding index databases to clean...');

      if ('indexedDB' in window) {
        try {
          const databases = await indexedDB.databases();
          const mrviewDbs = databases.filter(db =>
            db.name && db.name.includes('-mrview-')
          );

          this.updateProgress('rebuild', 15, `Found ${mrviewDbs.length} index databases to delete`);

          for (let i = 0; i < mrviewDbs.length; i++) {
            const dbName = mrviewDbs[i].name;
            if (dbName) {
              try {
                await new Promise<void>((resolve, reject) => {
                  const request = indexedDB.deleteDatabase(dbName);
                  request.onsuccess = () => resolve();
                  request.onerror = () => reject(request.error);
                  request.onblocked = () => {
                    console.warn(`Database ${dbName} is blocked, skipping`);
                    resolve();
                  };
                });
                deletedCount++;
              } catch (e) {
                console.warn(`Failed to delete ${dbName}:`, e);
              }
            }

            // Progress from 15% to 60%
            const progress = 15 + Math.floor((i / mrviewDbs.length) * 45);
            this.updateProgress('rebuild', progress, `Deleted ${i + 1} / ${mrviewDbs.length} index databases`);

            // Small delay to prevent blocking
            if (i % 5 === 0) {
              await new Promise(resolve => setTimeout(resolve, 10));
            }
          }
        } catch (e) {
          console.warn('indexedDB.databases() not supported or failed:', e);
        }
      }

      // Step 2: Try compact on the main database (may fail on mobile, that's ok)
      this.updateProgress('rebuild', 65, 'Attempting database compaction...');
      try {
        const db = await this.databaseService.getDatabase();
        await db.compact();
        this.updateProgress('rebuild', 85, 'Compaction complete');
      } catch (compactError) {
        console.warn('Compact failed (expected on mobile with large DB):', compactError);
        this.updateProgress('rebuild', 85, 'Compaction skipped (too large for mobile)');
      }

      // Wait for IndexedDB to settle
      this.updateProgress('rebuild', 90, 'Finalizing...');
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Measure final size
      const storageAfter = await this.getStorageEstimate();
      const sizeAfter = storageAfter.usage;
      const saved = sizeBefore - sizeAfter;

      const message = sizeBefore > 0 && sizeAfter > 0
        ? (saved > 0
            ? `Freed ${this.formatBytes(saved)} (${this.formatBytes(sizeBefore)} → ${this.formatBytes(sizeAfter)})`
            : `Storage: ${this.formatBytes(sizeAfter)} (deleted ${deletedCount} index DBs)`)
        : `Deleted ${deletedCount} index databases`;

      this.updateProgress('rebuild', 100, message);

      return {
        sizeBefore,
        sizeAfter,
        saved,
        deletedDatabases: deletedCount
      };
    } catch (error) {
      console.error('Error during deep clean:', error);
      this.updateProgress('rebuild', 0, 'Error during deep clean');
      throw error;
    }
  }

/**
   * One-time cleanup utility to remove legacy image/video documents from PouchDB.
   * This removes documents with old prefixes:
   * - image_* (old global images)
   * - video_* (old global videos)
   * - image-video-association_* (old associations)
   *
   * New per-story documents use story-image_* and story-video_* prefixes.
   * This is safe to run multiple times - it only removes legacy data.
   *
   * TODO: Remove this method after 2026-03-01 - migration cleanup no longer needed
   */
  async cleanupLegacyMediaData(): Promise<{
    imagesDeleted: number;
    videosDeleted: number;
    associationsDeleted: number;
    totalDeleted: number;
    errors: string[];
  }> {
    this.updateProgress('legacy-cleanup', 0, 'Scanning for legacy media documents...');

    const result = {
      imagesDeleted: 0,
      videosDeleted: 0,
      associationsDeleted: 0,
      totalDeleted: 0,
      errors: [] as string[]
    };

    try {
      const db = await this.databaseService.getDatabase();

      // Fetch all documents to find legacy ones
      this.updateProgress('legacy-cleanup', 10, 'Loading all documents...');
      const allDocs = await db.allDocs({ include_docs: false });

      // Identify legacy documents by their ID prefix
      const legacyDocs = allDocs.rows.filter(row => {
        const id = row.id;
        // Old image documents: image_{uuid}
        if (id.startsWith('image_') && !id.startsWith('image-video-')) return true;
        // Old video documents: video_{uuid}
        if (id.startsWith('video_')) return true;
        // Old association documents: image-video-association_{uuid}
        if (id.startsWith('image-video-association_')) return true;
        return false;
      });

      if (legacyDocs.length === 0) {
        this.updateProgress('legacy-cleanup', 100, 'No legacy media documents found');
        return result;
      }

      this.updateProgress('legacy-cleanup', 20, `Found ${legacyDocs.length} legacy documents to delete`);

      // Delete each legacy document
      let processed = 0;
      for (const row of legacyDocs) {
        try {
          // We need the full doc to get the _rev for deletion
          const doc = await db.get(row.id);
          await db.remove(doc);

          // Count by type
          if (row.id.startsWith('image-video-association_')) {
            result.associationsDeleted++;
          } else if (row.id.startsWith('image_')) {
            result.imagesDeleted++;
          } else if (row.id.startsWith('video_')) {
            result.videosDeleted++;
          }

          result.totalDeleted++;
        } catch (deleteError) {
          const errorMsg = `Failed to delete ${row.id}: ${deleteError}`;
          console.warn(errorMsg);
          result.errors.push(errorMsg);
        }

        processed++;
        const progress = 20 + Math.floor((processed / legacyDocs.length) * 70);
        this.updateProgress('legacy-cleanup', progress,
          `Deleted ${processed}/${legacyDocs.length} legacy documents`);

        // Small delay every 10 docs to prevent blocking UI
        if (processed % 10 === 0) {
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      }

      // Compact to reclaim space
      this.updateProgress('legacy-cleanup', 95, 'Compacting database...');
      try {
        await db.compact();
      } catch (compactError) {
        console.warn('Compact after cleanup failed:', compactError);
      }

      const summary = `Deleted ${result.imagesDeleted} images, ${result.videosDeleted} videos, ${result.associationsDeleted} associations`;
      this.updateProgress('legacy-cleanup', 100, summary);

      return result;
    } catch (error) {
      console.error('Error during legacy media cleanup:', error);
      this.updateProgress('legacy-cleanup', 0, 'Error during cleanup');
      throw error;
    }
  }

  /**
   * Gets current storage usage information
   */
  async getStorageUsage(): Promise<{ used: number; quota: number; percentage: number; formatted: string }> {
    const estimate = await this.getStorageEstimate();
    const used = estimate.usage;
    const quota = estimate.quota;
    const percentage = quota > 0 ? (used / quota) * 100 : 0;

    return {
      used,
      quota,
      percentage,
      formatted: quota > 0
        ? `${this.formatBytes(used)} / ${this.formatBytes(quota)} (${percentage.toFixed(1)}%)`
        : 'Storage API not available'
    };
  }

  /**
   * Checks story integrity and finds issues
   */
  async checkStoryIntegrity(): Promise<IntegrityIssue[]> {
    this.updateProgress('integrity', 0, 'Loading all stories...');

    try {
      const allStories = await this.storyService.getAllStories();
      this.updateProgress('integrity', 20, `${allStories.length} stories loaded`);

      const issues: IntegrityIssue[] = [];
      let processedCount = 0;

      for (const story of allStories) {
        // Check for missing chapters
        if (!story.chapters || story.chapters.length === 0) {
          issues.push({
            type: 'missing_chapters',
            storyId: story.id,
            storyTitle: story.title || 'Untitled Story',
            description: 'Story has no chapters',
            severity: 'high'
          });
        } else {
          // Check each chapter for missing scenes
          for (const chapter of story.chapters) {
            if (!chapter.scenes || chapter.scenes.length === 0) {
              issues.push({
                type: 'missing_scenes',
                storyId: story.id,
                storyTitle: story.title || 'Untitled Story',
                description: `Chapter "${chapter.title}" has no scenes`,
                severity: 'medium'
              });
            }
          }
        }

        // Check for corrupt data (basic validation)
        if (!story.id || !story.createdAt || !story.updatedAt) {
          issues.push({
            type: 'corrupt_data',
            storyId: story.id || 'unknown',
            storyTitle: story.title || 'Untitled Story',
            description: 'Story has missing or corrupt metadata',
            severity: 'high'
          });
        }

        processedCount++;
        this.updateProgress('integrity', 20 + (processedCount / allStories.length) * 80,
          `Checking story ${processedCount}/${allStories.length}`);
      }

      this.updateProgress('integrity', 100, `${issues.length} integrity issues found`);

      return issues;
    } catch (error) {
      console.error('Error checking story integrity:', error);
      this.updateProgress('integrity', 0, 'Error checking integrity');
      throw error;
    }
  }

  /**
   * Gets database statistics from local database
   */
  async getDatabaseStats(): Promise<DatabaseStats> {
    this.updateProgress('stats', 0, 'Collecting statistics...');

    try {
      const db = await this.databaseService.getDatabase();
      const allDocsResult = await db.allDocs({ include_docs: true });

      this.updateProgress('stats', 20, 'Calculating sizes...');

      let storyCount = 0;
      let totalSize = 0;
      let totalDocuments = 0;

      let lastProgressUpdate = Date.now();
      const PROGRESS_INTERVAL = 100; // ms - time-based throttling for mobile

      for (let i = 0; i < allDocsResult.rows.length; i++) {
        const row = allDocsResult.rows[i];
        if (!row.doc || row.id.startsWith('_')) continue;

        totalDocuments++;
        totalSize += JSON.stringify(row.doc).length;

        const doc = row.doc as { chapters?: unknown[] };
        if (doc.chapters && Array.isArray(doc.chapters)) {
          storyCount++;
        }

        // Time-based progress updates with UI yielding for mobile performance
        const now = Date.now();
        if (now - lastProgressUpdate > PROGRESS_INTERVAL) {
          const progress = 20 + Math.floor((i / allDocsResult.rows.length) * 70);
          this.updateProgress('stats', progress, `Analyzing ${i}/${allDocsResult.rows.length} documents...`);
          lastProgressUpdate = now;
          // Yield to UI thread to prevent blocking on mobile
          await new Promise(resolve => setTimeout(resolve, 0));
        }
      }

      const stats: DatabaseStats = {
        totalStories: storyCount,
        actualSize: totalSize,
        totalDocuments
      };

      this.updateProgress('stats', 100, 'Statistics created');

      return stats;
    } catch (error) {
      console.error('Error getting database stats:', error);
      this.updateProgress('stats', 0, 'Error collecting statistics');
      throw error;
    }
  }

  /**
   * Exports complete database as JSON
   */
  async exportDatabase(): Promise<string> {
    this.updateProgress('export', 0, 'Collecting all data...');

    try {
      const allStories = await this.storyService.getAllStories();

      this.updateProgress('export', 70, 'Creating export...');

      const exportData = {
        exportDate: new Date().toISOString(),
        version: '2.0',
        stories: allStories
      };

      this.updateProgress('export', 100, 'Export created');

      return JSON.stringify(exportData, null, 2);
    } catch (error) {
      console.error('Error exporting database:', error);
      this.updateProgress('export', 0, 'Error creating export');
      throw error;
    }
  }

  /**
   * Formats bytes to human readable string
   */
  formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes';

    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * Clears operation progress
   */
  clearProgress(): void {
    this.operationProgress.next({ operation: '', progress: 0, message: '' });
  }
}
