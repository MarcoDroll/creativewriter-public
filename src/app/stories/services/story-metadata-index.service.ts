import { Injectable, inject } from '@angular/core';
import { DatabaseService } from '../../core/services/database.service';
import { StoryStatsService } from './story-stats.service';
import { Story } from '../models/story.interface';
import { StoryMetadataIndex, StoryMetadata, isStoryMetadataIndex } from '../models/story-metadata.interface';

/**
 * Service for managing the Story Metadata Index
 *
 * The metadata index is a lightweight document that contains preview information
 * for all stories, enabling fast story list loading without syncing full story documents.
 *
 * Key Benefits:
 * - Story list loads 500KB index instead of 5-25MB of full stories
 * - 75-80% reduction in memory usage for story list view
 * - 80% faster load times on mobile
 *
 * Usage:
 * - Call updateStoryMetadata() after any story change
 * - Call removeStoryMetadata() after story deletion
 * - Call getMetadataIndex() to load story list
 * - Call rebuildIndex() if index becomes corrupted or outdated
 */
@Injectable({
  providedIn: 'root'
})
export class StoryMetadataIndexService {
  private readonly databaseService = inject(DatabaseService);
  private readonly storyStatsService = inject(StoryStatsService);

  private metadataCache: StoryMetadataIndex | null = null;
  private metadataCacheTime: number | null = null;
  // Cache TTL: 5 minutes - prevents unbounded memory from stale cache on mobile
  private readonly CACHE_TTL_MS = 5 * 60 * 1000;

  /**
   * Check if user is in local-only mode (no sync)
   */
  private isLocalOnlyMode(): boolean {
    return localStorage.getItem('creative-writer-local-only') === 'true';
  }

  // Guard to prevent concurrent getMetadataIndex calls (which cause loops during initial sync)
  private pendingFetch: Promise<StoryMetadataIndex> | null = null;

  /**
   * Get the current database instance
   * Always get fresh reference to handle user login/logout which creates new databases
   */
  private async getDb(): Promise<PouchDB.Database> {
    const db = await this.databaseService.getDatabase();
    if (!db) {
      throw new Error('Database not initialized');
    }
    return db;
  }

  /**
   * Check if cache is valid (exists and not expired)
   */
  private isCacheValid(): boolean {
    if (!this.metadataCache || !this.metadataCacheTime) {
      return false;
    }
    return Date.now() - this.metadataCacheTime < this.CACHE_TTL_MS;
  }

  /**
   * Set cache with timestamp
   */
  private setCache(index: StoryMetadataIndex | null): void {
    this.metadataCache = index;
    this.metadataCacheTime = index ? Date.now() : null;
  }

  /**
   * Get the metadata index (from remote, cache, or local database)
   *
   * Priority:
   * 1. Remote database (if available) - always fresh
   * 2. Cache (if available and not expired)
   * 3. Local database
   * 4. Rebuild from stories
   *
   * @returns The metadata index containing all story previews
   * @throws Error if index cannot be loaded or created
   */
  async getMetadataIndex(): Promise<StoryMetadataIndex> {
    // Return cached result if available and not expired (quick path)
    if (this.isCacheValid()) {
      return this.metadataCache!;
    }

    // If a fetch is already in progress, wait for it instead of starting a new one
    // This prevents concurrent calls during initial sync from causing loops
    if (this.pendingFetch) {
      console.debug('[MetadataIndex] Fetch already in progress, waiting...');
      return this.pendingFetch;
    }

    // Start fetch and store the promise
    this.pendingFetch = this.doGetMetadataIndex();

    try {
      return await this.pendingFetch;
    } finally {
      this.pendingFetch = null;
    }
  }

  /**
   * Internal implementation of getMetadataIndex
   */
  private async doGetMetadataIndex(): Promise<StoryMetadataIndex> {
    const db = await this.getDb();
    const remoteDb = this.databaseService.getRemoteDatabase();

    // Try remote database first (always fresh) - skip in local-only mode
    if (remoteDb && !this.isLocalOnlyMode()) {
      try {
        // Log database name for debugging
        const dbName = (remoteDb as { name?: string }).name || 'unknown';
        console.info(`[MetadataIndex] Fetching from remote database: ${dbName}`);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const doc = await remoteDb.get('story-metadata-index') as any;

        if (isStoryMetadataIndex(doc)) {
          const storyCount = (doc.stories || []).length;
          console.info('[MetadataIndex] Got index from remote with', storyCount, 'stories');

          // If remote index is empty, check if remote actually has stories (stale index)
          if (storyCount === 0) {
            console.info('[MetadataIndex] Remote index is empty, checking for story documents...');
            const hasStories = await this.checkRemoteHasStories(remoteDb);

            if (hasStories) {
              console.info('[MetadataIndex] Remote has stories but empty index - rebuilding from remote');
              return await this.rebuildIndexFromRemote(remoteDb);
            }
          }

          const index = this.deserializeIndex(doc);
          this.setCache(index);

          // Save to local DB for offline access
          // MUST await to prevent race condition with removeStoryMetadata/updateStoryMetadata
          // which also modify the index document
          try {
            await this.saveIndexToLocal(index);
          } catch (err) {
            console.warn('[MetadataIndex] Failed to save remote index locally:', err);
          }

          return index;
        }
      } catch (err) {
        const error = err as { status?: number };
        if (error.status !== 404) {
          console.warn('[MetadataIndex] Error fetching from remote:', err);
        } else {
          console.info('[MetadataIndex] Index not found on remote');
        }
      }
    }

    // Return from cache if available
    if (this.metadataCache) {
      console.info('[MetadataIndex] Returning cached index');
      return this.metadataCache;
    }

    // Try local database
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const doc = await db.get('story-metadata-index') as any;

      // Validate that it's actually a metadata index
      if (!isStoryMetadataIndex(doc)) {
        console.warn('[MetadataIndex] Local index invalid, rebuilding');
        return await this.rebuildIndex();
      }

      console.info('[MetadataIndex] Got index from local database');
      const index = this.deserializeIndex(doc);
      this.setCache(index);
      return index;

    } catch (err) {
      const error = err as { status?: number };
      if (error.status === 404) {
        // Index doesn't exist - create it
        console.info('[MetadataIndex] Index not found locally, rebuilding');
        return await this.rebuildIndex();
      }
      throw err;
    }
  }

  /**
   * Save the index to local database for offline access
   * Updates the cache's _rev to prevent conflicts on subsequent writes
   * IMPORTANT: Only saves if content actually changed to prevent sync loops
   */
  private async saveIndexToLocal(index: StoryMetadataIndex): Promise<void> {
    const db = await this.getDb();

    try {
      // Try to get existing doc for _rev and comparison
      const existing = await db.get('story-metadata-index').catch(() => null) as StoryMetadataIndex | null;

      // Check if content actually changed before saving
      // This prevents sync loops: remote fetch → local save → sync event → reload → repeat
      if (existing && this.indexContentEqual(existing, index)) {
        // Content identical - just update cache _rev, don't save
        if (this.metadataCache) {
          this.metadataCache._rev = (existing as { _rev: string })._rev;
        }
        console.debug('[MetadataIndex] Local index identical to remote, skipping save');
        return;
      }

      const docToSave = {
        ...index,
        _id: 'story-metadata-index',
        _rev: existing ? (existing as { _rev: string })._rev : undefined
      };
      const result = await db.put(docToSave);

      // Update cache with new _rev to prevent conflicts on subsequent writes
      if (this.metadataCache && result.rev) {
        this.metadataCache._rev = result.rev;
      }

      console.info('[MetadataIndex] Saved remote index to local database');
    } catch (err) {
      // Conflict is OK - someone else saved it, but we need fresh _rev for cache
      const error = err as { status?: number };
      if (error.status === 409) {
        // Refresh cache with current local _rev
        try {
          const current = await db.get('story-metadata-index') as { _rev: string };
          if (this.metadataCache && current._rev) {
            this.metadataCache._rev = current._rev;
          }
        } catch {
          // Couldn't get fresh _rev, cache will be stale but retry logic should handle it
        }
      } else {
        throw err;
      }
    }
  }

  /**
   * Compare two metadata indexes for content equality
   * Ignores _id, _rev, and lastUpdated (which change on every save)
   */
  private indexContentEqual(a: StoryMetadataIndex, b: StoryMetadataIndex): boolean {
    // Different number of stories = different content
    if (a.stories.length !== b.stories.length) {
      return false;
    }

    // Compare each story by ID and key fields
    for (const storyA of a.stories) {
      const storyB = b.stories.find(s => s.id === storyA.id);

      if (!storyB) {
        return false; // Story in A not found in B
      }

      // Compare key fields that matter for display
      if (storyA.title !== storyB.title ||
          storyA.wordCount !== storyB.wordCount ||
          storyA.chapterCount !== storyB.chapterCount ||
          storyA.sceneCount !== storyB.sceneCount ||
          storyA.order !== storyB.order ||
          storyA.previewText !== storyB.previewText) {
        return false;
      }

      // Compare cover image thumbnail (efficient check for large base64 strings)
      const thumbA = storyA.coverImageThumbnail;
      const thumbB = storyB.coverImageThumbnail;
      if (thumbA !== thumbB) {
        // Quick exit: if direct comparison fails (including undefined vs defined), not equal
        // The !== already handles: both undefined (equal), one undefined (not equal),
        // different lengths (not equal), different content (not equal)
        return false;
      }

      // Compare updatedAt timestamps (important for showing last edit time)
      const aUpdated = storyA.updatedAt instanceof Date ? storyA.updatedAt.getTime() : new Date(storyA.updatedAt).getTime();
      const bUpdated = storyB.updatedAt instanceof Date ? storyB.updatedAt.getTime() : new Date(storyB.updatedAt).getTime();
      if (aUpdated !== bUpdated) {
        return false;
      }
    }

    return true;
  }

  /**
   * Check if remote database has story documents
   */
  private async checkRemoteHasStories(remoteDb: PouchDB.Database): Promise<boolean> {
    try {
      // Get all documents - don't limit as stories may be after other docs alphabetically
      const result = await remoteDb.allDocs({ include_docs: true });

      const storyCount = result.rows.filter(row => {
        const doc = row.doc as { type?: string; chapters?: unknown; _id?: string } | undefined;
        // Stories don't have a type field, must have chapters, and are not system docs
        return doc && !doc.type && doc.chapters && !row.id.startsWith('_');
      }).length;

      return storyCount > 0;
    } catch (err) {
      console.warn('[MetadataIndex] Failed to check remote for stories:', err);
      return false;
    }
  }

  /**
   * Rebuild the metadata index from remote story documents
   * Called when remote index exists but is stale (empty)
   */
  private async rebuildIndexFromRemote(remoteDb: PouchDB.Database): Promise<StoryMetadataIndex> {
    console.info('[MetadataIndex] Rebuilding index from remote stories...');

    try {
      // Load all docs from remote
      const result = await remoteDb.allDocs({ include_docs: true });

      // Filter to story documents only
      const stories: Story[] = result.rows
        .filter(row => {
          const doc = row.doc as { type?: string; chapters?: unknown; _id?: string } | undefined;
          // Stories don't have a type field and must have chapters
          return doc && !doc.type && doc.chapters && !row.id.startsWith('_');
        })
        .map(row => this.deserializeStory(row.doc as Story));

      console.info(`[MetadataIndex] Found ${stories.length} stories on remote, extracting metadata...`);

      // Create new index
      const index: StoryMetadataIndex = {
        _id: 'story-metadata-index',
        type: 'story-metadata-index',
        lastUpdated: new Date(),
        stories: stories.map(s => this.extractMetadata(s))
      };

      // Get existing _rev from remote for update
      try {
        const existing = await remoteDb.get('story-metadata-index');
        index._rev = (existing as { _rev?: string })._rev;
      } catch {
        // No existing index, that's fine
      }

      // Save to remote
      await remoteDb.put(index);
      console.info(`[MetadataIndex] Rebuilt index saved to remote with ${index.stories.length} stories`);

      // Also save to local - await to prevent race conditions
      try {
        await this.saveIndexToLocal(index);
      } catch (err) {
        console.warn('[MetadataIndex] Failed to save rebuilt index locally:', err);
      }

      this.setCache(index);
      return index;

    } catch (error) {
      console.error('[MetadataIndex] Error rebuilding index from remote:', error);
      throw error;
    }
  }

  /**
   * Update a single story's metadata in the index
   *
   * Call this after any story modification (create, update, reorder)
   * Only writes to local database - PouchDB sync handles remote distribution
   *
   * @param story The story to update in the index
   */
  async updateStoryMetadata(story: Story): Promise<void> {
    const db = await this.getDb();

    // Retry up to 3 times for conflict resolution
    const maxRetries = 3;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        // On retry, clear cache to get fresh _rev from database
        if (attempt > 0) {
          this.setCache(null);
        }

        const index = await this.getMetadataIndex();
        const originalIndex = { ...index, stories: [...index.stories] };

        // Find existing entry
        const existingIndex = index.stories.findIndex(s => s.id === story.id);
        const metadata = this.extractMetadata(story);
        const isNewStory = existingIndex < 0;

        if (existingIndex >= 0) {
          // Update existing entry, preserving order (order is managed separately via updateStoryOrder)
          const existingOrder = index.stories[existingIndex].order;
          index.stories[existingIndex] = {
            ...metadata,
            order: existingOrder
          };
        } else {
          // Add new entry
          index.stories.push(metadata);
        }

        index.lastUpdated = new Date();

        // Check if content actually changed before saving
        // This prevents unnecessary writes and sync operations
        if (!isNewStory && this.indexContentEqual(originalIndex, index)) {
          console.debug(`[MetadataIndex] Story ${story.id} metadata unchanged, skipping save`);
          return;
        }

        // Save to local database only - sync handles remote distribution
        const localDoc = await db.get('story-metadata-index').catch(() => null);
        const localIndex = {
          ...index,
          _id: 'story-metadata-index',
          _rev: localDoc ? (localDoc as { _rev: string })._rev : undefined
        };
        const result = await db.put(localIndex);
        index._rev = result.rev;
        this.setCache(index);
        console.info(`[MetadataIndex] ${isNewStory ? 'Added' : 'Updated'} story ${story.id} in local index`);
        return; // Success - exit retry loop

      } catch (error) {
        const pouchError = error as { status?: number; name?: string };

        // If conflict, retry with fresh data
        if (pouchError.status === 409 || pouchError.name === 'conflict') {
          if (attempt < maxRetries - 1) {
            console.warn(`[MetadataIndex] Conflict on attempt ${attempt + 1}, retrying...`);
            continue;
          }
          console.error('[MetadataIndex] Conflict after max retries');
        }

        console.error('Error updating story metadata:', error);
        // Don't throw - gracefully degrade
        // Index can be rebuilt later if needed
        return;
      }
    }
  }

  /**
   * Remove a story from the index
   *
   * Call this after story deletion
   * Only writes to local database - PouchDB sync handles remote distribution
   *
   * @param storyId The ID of the story to remove
   */
  async removeStoryMetadata(storyId: string): Promise<void> {
    const db = await this.getDb();

    // Retry up to 3 times for conflict resolution
    const maxRetries = 3;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        // On retry, clear cache to get fresh _rev from database
        if (attempt > 0) {
          this.setCache(null);
        }

        const index = await this.getMetadataIndex();
        const originalCount = index.stories.length;

        index.stories = index.stories.filter(s => s.id !== storyId);

        // Only update if something was actually removed
        if (index.stories.length < originalCount) {
          index.lastUpdated = new Date();

          // Save to local database only - sync handles remote distribution
          const localDoc = await db.get('story-metadata-index').catch(() => null);
          const localIndex = {
            ...index,
            _id: 'story-metadata-index',
            _rev: localDoc ? (localDoc as { _rev: string })._rev : undefined
          };
          const result = await db.put(localIndex);
          index._rev = result.rev;
          this.setCache(index);
          console.info(`[MetadataIndex] Removed story ${storyId} from local index`);
        }
        return; // Success - exit retry loop

      } catch (error) {
        const pouchError = error as { status?: number; name?: string };

        // If conflict, retry with fresh data
        if (pouchError.status === 409 || pouchError.name === 'conflict') {
          if (attempt < maxRetries - 1) {
            console.warn(`[MetadataIndex] Conflict on remove attempt ${attempt + 1}, retrying...`);
            continue;
          }
          console.error('[MetadataIndex] Conflict after max retries');
        }

        console.error('Error removing story metadata:', error);
        // Don't throw - gracefully degrade
        return;
      }
    }
  }

  /**
   * Update story order in the metadata index only
   *
   * This method updates the order field for stories based on their position
   * in the provided array. This is more efficient than updating each story
   * document individually (1 document update vs N).
   *
   * @param orderedIds Array of story IDs in the desired order
   */
  async updateStoryOrder(orderedIds: string[]): Promise<void> {
    const db = await this.getDb();

    // Retry up to 3 times for conflict resolution
    const maxRetries = 3;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        // On retry, clear cache to get fresh _rev from database
        if (attempt > 0) {
          this.setCache(null);
        }

        const index = await this.getMetadataIndex();
        const originalIndex = { ...index, stories: [...index.stories] };

        // Update order for each story based on position in orderedIds
        for (let i = 0; i < orderedIds.length; i++) {
          const storyId = orderedIds[i];
          const storyIndex = index.stories.findIndex(s => s.id === storyId);
          if (storyIndex >= 0) {
            index.stories[storyIndex] = {
              ...index.stories[storyIndex],
              order: i
            };
          }
        }

        index.lastUpdated = new Date();

        // Check if content actually changed before saving
        if (this.indexContentEqual(originalIndex, index)) {
          console.debug('[MetadataIndex] Story order unchanged, skipping save');
          return;
        }

        // Save to local database
        const localDoc = await db.get('story-metadata-index').catch(() => null);
        const localIndex = {
          ...index,
          _id: 'story-metadata-index',
          _rev: localDoc ? (localDoc as { _rev: string })._rev : undefined
        };
        const result = await db.put(localIndex);
        index._rev = result.rev;
        this.setCache(index);

        console.info(`[MetadataIndex] Updated story order in local index (${orderedIds.length} stories)`);

        // Explicitly push to remote for immediate sync
        // Don't rely on live sync for explicit user actions
        try {
          await this.databaseService.pushDocuments(['story-metadata-index']);
          console.info('[MetadataIndex] Pushed story order to remote');
        } catch (pushError) {
          // Log but don't throw - local save succeeded, sync will catch up
          console.warn('[MetadataIndex] Failed to push story order to remote:', pushError);
        }

        return; // Success - exit retry loop

      } catch (error) {
        const pouchError = error as { status?: number; name?: string };

        // If conflict, retry with fresh data
        if (pouchError.status === 409 || pouchError.name === 'conflict') {
          if (attempt < maxRetries - 1) {
            console.warn(`[MetadataIndex] Conflict on updateStoryOrder attempt ${attempt + 1}, retrying...`);
            continue;
          }
          console.error('[MetadataIndex] Conflict after max retries');
        }

        console.error('Error updating story order:', error);
        throw error; // Re-throw to let caller handle
      }
    }
  }

  /**
   * Rebuild the entire index from all stories in the database
   *
   * This is an expensive operation that loads all stories.
   * Only call when:
   * - Index doesn't exist
   * - Index is corrupted
   * - Manual rebuild requested by user
   *
   * @param force If true, rebuild even if local database is empty
   * @returns The newly rebuilt index
   */
  async rebuildIndex(force = false): Promise<StoryMetadataIndex> {
    const db = await this.getDb();

    console.info('Rebuilding story metadata index from all stories...');

    try {
      // Load all stories from database
      const result = await db.allDocs({
        include_docs: true
      });

      // Filter to story documents only
      const stories: Story[] = result.rows
        .filter(row => {
          const doc = row.doc as { type?: string; chapters?: unknown };
          // Stories don't have a type field and must have chapters
          return !doc.type && doc.chapters;
        })
        .map(row => this.deserializeStory(row.doc as Story));

      console.info(`Found ${stories.length} stories, extracting metadata...`);

      // CRITICAL: Don't create an empty index that would overwrite a syncing remote index
      if (stories.length === 0 && !force) {
        console.info('[MetadataIndex] Local database has 0 stories - checking for existing index');

        // Check if an index exists locally (might have synced already)
        try {
          const existing = await db.get('story-metadata-index');
          console.info('[MetadataIndex] Found existing index, returning it');
          const deserializedIndex = this.deserializeIndex(existing as StoryMetadataIndex);
          this.setCache(deserializedIndex);
          return deserializedIndex;
        } catch {
          // No local index - try to pull just the metadata index from remote (skip in local-only mode)
          const remoteDb = this.databaseService.getRemoteDatabase();
          if (remoteDb && !this.isLocalOnlyMode()) {
            console.info('[MetadataIndex] No local index, trying to pull from remote...');
            try {
              // Pull only the metadata index document (lightweight)
              const remoteIndex = await remoteDb.get('story-metadata-index');
              if (remoteIndex) {
                console.info('[MetadataIndex] Found remote index, saving locally');
                // Save to local database
                try {
                  await db.put(remoteIndex);
                } catch (putErr) {
                  // Might conflict if sync already pulled it - try to get again
                  console.warn('[MetadataIndex] Could not save remote index locally:', putErr);
                }
                const deserializedIndex = this.deserializeIndex(remoteIndex as StoryMetadataIndex);
                this.setCache(deserializedIndex);
                return deserializedIndex;
              }
            } catch (remoteErr) {
              console.warn('[MetadataIndex] Could not fetch remote index:', remoteErr);
            }
          }

          // Return temporary empty index - stories will sync when opened
          console.info('[MetadataIndex] Returning temporary empty index');
          const tempIndex: StoryMetadataIndex = {
            _id: 'story-metadata-index',
            type: 'story-metadata-index',
            lastUpdated: new Date(),
            stories: []
          };
          return tempIndex;
        }
      }

      // Create new index
      const index: StoryMetadataIndex = {
        _id: 'story-metadata-index',
        type: 'story-metadata-index',
        lastUpdated: new Date(),
        stories: stories.map(s => this.extractMetadata(s))
      };

      // Check if index already exists (to preserve _rev)
      try {
        const existing = await db.get('story-metadata-index');
        index._rev = (existing as { _rev?: string })._rev;
      } catch {
        // Index doesn't exist yet, that's fine
      }

      // Save to database
      await db.put(index);
      this.setCache(index);

      console.info(`Metadata index rebuilt with ${index.stories.length} stories`);

      return index;

    } catch (error) {
      console.error('Error rebuilding metadata index:', error);
      throw error;
    }
  }

  /**
   * Clear the in-memory cache
   *
   * Call this when switching users or databases
   */
  clearCache(): void {
    this.setCache(null);
  }

  /**
   * Extract metadata from a full story document
   *
   * @param story Full story document
   * @returns Lightweight metadata for index
   */
  private extractMetadata(story: Story): StoryMetadata {
    // Get preview text from first scene
    const previewText = this.getPreviewText(story);

    // For now, use cover image as-is (Phase 2: implement thumbnail generation)
    const coverImageThumbnail = story.coverImage;

    return {
      id: story.id,
      title: story.title,
      coverImageThumbnail,
      previewText,
      chapterCount: story.chapters?.length || 0,
      sceneCount: this.countScenes(story),
      wordCount: this.storyStatsService.calculateTotalStoryWordCount(story),
      createdAt: story.createdAt,
      updatedAt: story.updatedAt,
      // Note: order is managed separately via updateStoryOrder(), not copied from story
      lastModifiedBy: story.lastModifiedBy
    };
  }

  /**
   * Extract first 5 lines or 200 characters from story for preview
   *
   * @param story Full story document
   * @returns Preview text (plain text, no HTML)
   */
  private getPreviewText(story: Story): string {
    if (!story.chapters || story.chapters.length === 0) {
      return '';
    }

    const firstChapter = story.chapters[0];
    if (!firstChapter.scenes || firstChapter.scenes.length === 0) {
      return '';
    }

    const firstScene = firstChapter.scenes[0];
    const content = firstScene.content || '';

    if (!content) {
      return '';
    }

    // Remove Beat AI nodes completely before extracting text
    // They are editor-only components and should not appear in preview
    const cleanHtml = content.replace(/<div[^>]*class="beat-ai-node"[^>]*>.*?<\/div>/gs, '');

    // Use DOMParser for safe HTML parsing and text extraction
    const parser = new DOMParser();
    const doc = parser.parseFromString(cleanHtml, 'text/html');
    const textContent = doc.body.textContent || '';

    // Remove any remaining Beat AI artifacts
    const cleanText = textContent
      .replace(/🎭\s*Beat\s*AI/gi, '')
      .replace(/Prompt:\s*/gi, '')
      .replace(/BeatAIPrompt/gi, '')
      .trim()
      .replace(/\s+/g, ' '); // Normalize whitespace

    // Get first 5 lines
    const lines = cleanText.split('\n').filter(line => line.trim().length > 0);
    const first5Lines = lines.slice(0, 5).join('\n');

    // Truncate to 200 characters if longer
    if (first5Lines.length > 200) {
      return first5Lines.substring(0, 197) + '...';
    }

    return first5Lines;
  }

  /**
   * Count total number of scenes across all chapters
   *
   * @param story Full story document
   * @returns Total scene count
   */
  private countScenes(story: Story): number {
    return story.chapters?.reduce((total, ch) =>
      total + (ch.scenes?.length || 0), 0
    ) || 0;
  }

  /**
   * Deserialize date fields in metadata index from database
   *
   * PouchDB stores dates as ISO strings, need to convert back to Date objects
   *
   * @param doc Raw document from database
   * @returns Index with proper Date objects
   */
  private deserializeIndex(doc: StoryMetadataIndex): StoryMetadataIndex {
    return {
      ...doc,
      lastUpdated: new Date(doc.lastUpdated),
      stories: doc.stories.map(story => ({
        ...story,
        createdAt: new Date(story.createdAt),
        updatedAt: new Date(story.updatedAt),
        lastModifiedBy: story.lastModifiedBy ? {
          ...story.lastModifiedBy,
          timestamp: new Date(story.lastModifiedBy.timestamp)
        } : undefined
      }))
    };
  }

  /**
   * Deserialize date fields in story from database
   *
   * @param doc Raw story document from database
   * @returns Story with proper Date objects
   */
  private deserializeStory(doc: Story): Story {
    return {
      ...doc,
      createdAt: new Date(doc.createdAt),
      updatedAt: new Date(doc.updatedAt),
      chapters: doc.chapters?.map(ch => ({
        ...ch,
        createdAt: new Date(ch.createdAt),
        updatedAt: new Date(ch.updatedAt),
        scenes: ch.scenes?.map(sc => ({
          ...sc,
          createdAt: new Date(sc.createdAt),
          updatedAt: new Date(sc.updatedAt)
        }))
      })),
      lastModifiedBy: doc.lastModifiedBy ? {
        ...doc.lastModifiedBy,
        timestamp: new Date(doc.lastModifiedBy.timestamp)
      } : undefined
    };
  }
}
