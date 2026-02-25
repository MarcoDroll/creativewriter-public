/**
 * Snapshot Service
 *
 * Queries snapshots from CouchDB via HTTP (snapshots are NOT synced to PouchDB)
 * Provides restore functionality and manual snapshot creation
 */

import { Injectable, inject } from '@angular/core';
import { AuthService } from '../../core/services/auth.service';
import { DatabaseService } from '../../core/services/database.service';
import { Story, Chapter, StorySettings } from '../models/story.interface';

export interface RelatedDocuments {
  codex: Record<string, unknown> | null;
  characterChats: Record<string, unknown>[];
  sceneChats: Record<string, unknown>[];
  storyResearch: Record<string, unknown>[];
  storyImages: Record<string, unknown>[];
  storyVideos: Record<string, unknown>[];
}

export interface StorySnapshot {
  _id: string;
  _rev?: string;
  type: 'story-snapshot';
  storyId: string;
  userId: string;
  createdAt: string;
  retentionTier: 'granular' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'manual';
  expiresAt?: string;
  snapshotType: 'auto' | 'manual';
  triggeredBy: 'scheduler' | 'user' | 'event';
  reason?: string;

  snapshot: {
    title: string;
    chapters: Chapter[];
    settings?: StorySettings;
    updatedAt: Date | string;
  };

  // Related documents captured by external snapshot service
  relatedDocuments?: RelatedDocuments;

  metadata: {
    wordCount: number;
    chapterCount: number;
    sceneCount: number;
    // Extended metadata for related documents
    hasCodex?: boolean;
    characterChatCount?: number;
    sceneChatCount?: number;
    researchCount?: number;
    imageCount?: number;
    videoCount?: number;
  };
}

export interface RestoreOptions {
  createBackup?: boolean;
  includeRelatedDocuments?: boolean;
}

export interface SnapshotTimeline {
  recent: StorySnapshot[];    // Last 4 hours (15-min)
  hourly: StorySnapshot[];    // Last 24 hours
  daily: StorySnapshot[];     // Last 30 days
  weekly: StorySnapshot[];    // Last 12 weeks
  monthly: StorySnapshot[];   // Last 12 months
  manual: StorySnapshot[];    // User-created snapshots
}

@Injectable({
  providedIn: 'root'
})
export class SnapshotService {
  private readonly authService = inject(AuthService);
  private readonly databaseService = inject(DatabaseService);

  /**
   * Get CouchDB URL for direct HTTP queries
   */
  private getCouchDBUrl(): string {
    const hostname = window.location.hostname;
    const protocol = window.location.protocol;
    const port = window.location.port;

    // Get current database name (user-specific)
    const db = this.databaseService.getDatabaseSync();
    const dbName = db ? db.name : 'creative-writer-stories-anonymous';

    // Use reverse proxy path
    const baseUrl = port ? `${protocol}//${hostname}:${port}` : `${protocol}//${hostname}`;
    return `${baseUrl}/_db/${dbName}`;
  }

  /**
   * Create basic auth header
   */
  private getAuthHeader(): string {
    const authHeader = this.authService.getBasicAuthHeader();
    if (!authHeader) {
      throw new Error('Cloud sync credentials missing. Please sign in.');
    }
    return authHeader;
  }

  /**
   * Fetch snapshots directly from CouchDB via HTTP
   */
  async getSnapshotsForStory(storyId: string): Promise<StorySnapshot[]> {
    const couchUrl = this.getCouchDBUrl();
    const authHeader = this.getAuthHeader();

    try {
      // Build query parameters with proper JSON encoding
      // Note: When using descending=true, startkey and endkey must be reversed
      const startkey = JSON.stringify([storyId, {}]); // Larger key first for descending
      const endkey = JSON.stringify([storyId]);       // Smaller key second

      // Query CouchDB view
      const response = await fetch(
        `${couchUrl}/_design/snapshots/_view/by_story_and_date?` +
        `startkey=${encodeURIComponent(startkey)}&` +
        `endkey=${encodeURIComponent(endkey)}&` +
        `include_docs=true&descending=true`,
        {
          headers: {
            'Authorization': authHeader,
            'Content-Type': 'application/json'
          }
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch snapshots: ${response.statusText}`);
      }

      const result = await response.json();
      return result.rows.map((row: { doc: StorySnapshot }) => row.doc);
    } catch (error) {
      console.error('[SnapshotService] Failed to fetch snapshots:', error);
      throw error;
    }
  }

  /**
   * Get organized snapshot timeline
   */
  async getSnapshotTimeline(storyId: string): Promise<SnapshotTimeline> {
    const snapshots = await this.getSnapshotsForStory(storyId);

    return {
      recent: snapshots.filter(s => s.retentionTier === 'granular'),
      hourly: snapshots.filter(s => s.retentionTier === 'hourly'),
      daily: snapshots.filter(s => s.retentionTier === 'daily'),
      weekly: snapshots.filter(s => s.retentionTier === 'weekly'),
      monthly: snapshots.filter(s => s.retentionTier === 'monthly'),
      manual: snapshots.filter(s => s.retentionTier === 'manual')
    };
  }

  /**
   * Get a single snapshot by ID
   */
  async getSnapshot(snapshotId: string): Promise<StorySnapshot> {
    const couchUrl = this.getCouchDBUrl();
    const authHeader = this.getAuthHeader();

    try {
      const response = await fetch(`${couchUrl}/${snapshotId}`, {
        headers: {
          'Authorization': authHeader,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch snapshot: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('[SnapshotService] Failed to fetch snapshot:', error);
      throw error;
    }
  }

  /**
   * Restore story from snapshot
   */
  async restoreFromSnapshot(
    storyId: string,
    snapshotId: string,
    options: RestoreOptions = {}
  ): Promise<Story> {
    const { createBackup = false, includeRelatedDocuments = false } = options;

    try {
      // Get local PouchDB (for story updates)
      const db = await this.databaseService.getDatabase();

      // Fetch snapshot from CouchDB via HTTP
      const snapshot = await this.getSnapshot(snapshotId);

      // Validate snapshot belongs to this story
      if (snapshot.storyId !== storyId) {
        throw new Error(`Snapshot ${snapshotId} does not belong to story ${storyId}`);
      }

      // Get current story from PouchDB
      const currentStory = await db.get(storyId) as Story;

      // Create backup snapshot if requested
      if (createBackup) {
        await this.createManualSnapshot(currentStory, `Backup before restore to ${snapshotId}`);
      }

      // Restore snapshot content to story
      const restoredStory: Story = {
        ...currentStory,  // Keep _id, _rev, etc.
        title: snapshot.snapshot.title,
        chapters: snapshot.snapshot.chapters,
        settings: snapshot.snapshot.settings,
        updatedAt: new Date()
      };

      // Update in PouchDB (will sync to CouchDB)
      const putResult = await db.put(restoredStory);
      // Update _rev so returned story can be used for further updates
      const finalStory = { ...restoredStory, _rev: putResult.rev };

      console.log('[SnapshotService] Story restored successfully from snapshot:', snapshotId);

      // Restore related documents if requested and available
      if (includeRelatedDocuments && snapshot.relatedDocuments) {
        try {
          const relatedResult = await this.restoreRelatedDocuments(db, storyId, snapshot.relatedDocuments);
          console.log('[SnapshotService] Related documents restoration:', relatedResult);
        } catch (relatedError) {
          // Log but don't fail - story is already restored
          console.error('[SnapshotService] Related documents restoration failed:', relatedError);
        }
      }

      return finalStory;
    } catch (error) {
      console.error('[SnapshotService] Failed to restore from snapshot:', error);
      throw error;
    }
  }

  /**
   * Create manual snapshot via the external snapshot service.
   * The service captures all related documents (codex, chats, research, media).
   *
   * @returns The snapshot ID
   * @throws Error if the snapshot service is unavailable or fails
   */
  async createManualSnapshot(story: Story, reason: string): Promise<string> {
    const db = this.databaseService.getDatabaseSync();
    const dbName = db?.name || 'creative-writer-stories-anonymous';

    // Set up abort controller with 30 second timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
      const response = await fetch(this.getSnapshotServiceUrl(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          dbName,
          storyId: story._id,
          reason
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Snapshot service error: ${response.statusText}`);
      }

      const result = await response.json();
      console.log('[SnapshotService] Manual snapshot created:', result.snapshotId);
      console.log('[SnapshotService] Related documents included:', result.relatedDocuments);
      return result.snapshotId;
    } catch (err) {
      clearTimeout(timeoutId);

      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error('Snapshot service timed out. Please try again.');
      }

      console.error('[SnapshotService] Failed to create manual snapshot:', err);
      throw err;
    }
  }

  /**
   * Get snapshot service API URL
   */
  private getSnapshotServiceUrl(): string {
    const hostname = window.location.hostname;
    const protocol = window.location.protocol;
    const port = window.location.port;

    const baseUrl = port ? `${protocol}//${hostname}:${port}` : `${protocol}//${hostname}`;
    return `${baseUrl}/api/snapshot`;
  }

  /**
   * Delete a snapshot (manual cleanup)
   */
  async deleteSnapshot(snapshotId: string): Promise<void> {
    const couchUrl = this.getCouchDBUrl();
    const authHeader = this.getAuthHeader();

    try {
      // Get snapshot to get _rev
      const snapshot = await this.getSnapshot(snapshotId);

      // Delete from CouchDB
      const response = await fetch(`${couchUrl}/${snapshotId}?rev=${snapshot._rev}`, {
        method: 'DELETE',
        headers: {
          'Authorization': authHeader,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to delete snapshot: ${response.statusText}`);
      }

      console.log('[SnapshotService] Snapshot deleted successfully:', snapshotId);
    } catch (error) {
      console.error('[SnapshotService] Failed to delete snapshot:', error);
      throw error;
    }
  }

  /**
   * Get count of snapshots for a story
   */
  async getSnapshotCount(storyId: string): Promise<number> {
    try {
      const snapshots = await this.getSnapshotsForStory(storyId);
      return snapshots.length;
    } catch (error) {
      console.error('[SnapshotService] Failed to get snapshot count:', error);
      return 0;
    }
  }

  /**
   * Check if snapshots are available (CouchDB connection)
   */
  async checkSnapshotAvailability(): Promise<boolean> {
    try {
      const couchUrl = this.getCouchDBUrl();
      const authHeader = this.getAuthHeader();

      const response = await fetch(`${couchUrl}/_design/snapshots`, {
        headers: {
          'Authorization': authHeader,
          'Content-Type': 'application/json'
        }
      });

      return response.ok;
    } catch {
      console.warn('[SnapshotService] Snapshots not available (offline or no CouchDB connection)');
      return false;
    }
  }

  // Helper methods

  private extractUserId(): string {
    const user = this.authService.getCurrentUser();
    return user?.username || 'anonymous';
  }

  private calculateWordCount(story: Story): number {
    let total = 0;
    story.chapters.forEach(chapter => {
      chapter.scenes.forEach(scene => {
        const text = this.stripHtml(scene.content || '');
        total += text.trim().split(/\s+/).filter(w => w.length > 0).length;
      });
    });
    return total;
  }

  private countScenes(story: Story): number {
    return story.chapters.reduce((sum, ch) => sum + ch.scenes.length, 0);
  }

  private stripHtml(html: string): string {
    const div = document.createElement('div');
    div.innerHTML = html;
    return div.textContent || div.innerText || '';
  }

  /**
   * Format timestamp for display
   */
  formatSnapshotTime(isoDate: string): string {
    const date = new Date(isoDate);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
    if (diffMins < 1440) return `${Math.floor(diffMins / 60)} hour${Math.floor(diffMins / 60) > 1 ? 's' : ''} ago`;
    if (diffMins < 10080) return `${Math.floor(diffMins / 1440)} day${Math.floor(diffMins / 1440) > 1 ? 's' : ''} ago`;

    return date.toLocaleString();
  }

  /**
   * Restore related documents from a snapshot using batched processing
   * Returns statistics about the restoration
   *
   * Uses batching to prevent memory issues on mobile devices when
   * restoring large media files (images up to 5MB, videos up to 50MB each)
   */
  private async restoreRelatedDocuments(
    db: PouchDB.Database,
    storyId: string,
    relatedDocs: RelatedDocuments
  ): Promise<{ successful: number; failed: number; total: number }> {
    const BATCH_SIZE = 5; // Small batches for memory efficiency on mobile
    let successful = 0;
    let failed = 0;
    let total = 0;

    // Helper to process a batch of documents
    const processBatch = async (docs: Record<string, unknown>[]) => {
      if (docs.length === 0) return;

      const results = await db.bulkDocs(docs);
      const batchSuccessful = results.filter((r: PouchDB.Core.Response | PouchDB.Core.Error) =>
        'ok' in r && r.ok
      ).length;
      successful += batchSuccessful;
      failed += results.length - batchSuccessful;
      total += docs.length;

      // Yield to main thread between batches to prevent UI freezing
      await new Promise(resolve => setTimeout(resolve, 0));
    };

    // Helper to process an array of documents in batches
    const processDocArray = async (
      docs: Record<string, unknown>[] | undefined,
      getDocId: (doc: Record<string, unknown>) => string | null
    ) => {
      if (!docs || !Array.isArray(docs)) return;

      let batch: Record<string, unknown>[] = [];

      for (const doc of docs) {
        if (!doc) continue;
        const docId = getDocId(doc);
        if (!docId) continue;

        const prepared = await this.prepareDocForRestore(db, doc, docId);
        if (prepared) {
          batch.push(prepared);
        }

        // Process batch when it reaches BATCH_SIZE
        if (batch.length >= BATCH_SIZE) {
          await processBatch(batch);
          batch = [];
        }
      }

      // Process remaining documents in the last batch
      if (batch.length > 0) {
        await processBatch(batch);
      }
    };

    // 1. Codex (single document, replace if exists)
    if (relatedDocs.codex) {
      const codexDoc = await this.prepareDocForRestore(
        db,
        relatedDocs.codex,
        `codex_${storyId}`
      );
      if (codexDoc) {
        await processBatch([codexDoc]);
      }
    }

    // 2. Process all array-based documents in batches
    // Extract _id from document for standard related docs
    const getIdFromDoc = (doc: Record<string, unknown>) =>
      typeof doc['_id'] === 'string' ? doc['_id'] : null;

    await processDocArray(relatedDocs.sceneChats, getIdFromDoc);
    await processDocArray(relatedDocs.characterChats, getIdFromDoc);
    await processDocArray(relatedDocs.storyResearch, getIdFromDoc);
    await processDocArray(relatedDocs.storyImages, getIdFromDoc);
    await processDocArray(relatedDocs.storyVideos, getIdFromDoc);

    console.log(`[SnapshotService] Restored ${successful} related documents (${failed} failed)`);

    return { successful, failed, total };
  }

  /**
   * Prepare a document for restore by getting current _rev if it exists
   * Returns null if the document cannot be prepared
   */
  private async prepareDocForRestore(
    db: PouchDB.Database,
    doc: Record<string, unknown>,
    docId: string
  ): Promise<Record<string, unknown> | null> {
    if (!doc || !docId) return null;

    try {
      // Check if document exists to get current _rev
      const existing = await db.get(docId) as PouchDB.Core.IdMeta & PouchDB.Core.GetMeta;
      // Document exists - update with current _rev to avoid conflict
      return { ...doc, _id: docId, _rev: existing._rev };
    } catch (err: unknown) {
      // Check for 404 status in a type-safe way
      if (err && typeof err === 'object' && 'status' in err && err.status === 404) {
        // Document doesn't exist - create new (remove any stale _rev from snapshot)
        const { _rev: _unusedRev, ...docWithoutRev } = doc;
        void _unusedRev; // Explicitly mark as intentionally unused
        return { ...docWithoutRev, _id: docId };
      }
      console.warn(`[SnapshotService] Error checking document ${docId}:`, err);
      return null;
    }
  }

  /**
   * Get related document counts from snapshot metadata
   * Useful for UI display before restore
   */
  getRelatedDocumentCounts(snapshot: StorySnapshot): {
    hasCodex: boolean;
    totalChats: number;
    researchCount: number;
    mediaCount: number;
  } {
    const meta = snapshot.metadata;
    return {
      hasCodex: meta.hasCodex ?? false,
      totalChats: (meta.characterChatCount ?? 0) + (meta.sceneChatCount ?? 0),
      researchCount: meta.researchCount ?? 0,
      mediaCount: (meta.imageCount ?? 0) + (meta.videoCount ?? 0)
    };
  }
}
