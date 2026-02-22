import { Injectable, inject } from '@angular/core';
import { Story, Chapter, Scene, DEFAULT_STORY_SETTINGS, NarrativePerspective, StoryTense } from '../models/story.interface';
import { DatabaseService } from '../../core/services/database.service';
import { DeviceService } from '../../core/services/device.service';
import { getSystemMessage, getBeatGenerationTemplate, getDefaultBeatRules } from '../../shared/resources/system-messages';
import { StoryLanguage } from '../../ui/components/language-selection-dialog/language-selection-dialog.component';
import { BeatHistoryService } from '../../shared/services/beat-history.service';
import { StoryMetadataIndexService } from './story-metadata-index.service';
import { countStories } from '../../shared/utils/document-filters';

// Current schema version for migration tracking
// Increment this when making breaking changes to Story structure
const CURRENT_SCHEMA_VERSION = 1;

@Injectable({
  providedIn: 'root'
})
export class StoryService {
  private readonly databaseService = inject(DatabaseService);
  private readonly beatHistoryService = inject(BeatHistoryService);
  private readonly deviceService = inject(DeviceService);
  private readonly metadataIndexService = inject(StoryMetadataIndexService);
  private db: PouchDB.Database | null = null;

  // Performance optimization: Cache for story previews and word counts
  private previewCache = new Map<string, string>();
  private wordCountCache = new Map<string, number>();

  // Sync push throttling - PouchDB live sync with filters doesn't push local changes
  // so we need to manually trigger push after saves
  private pushPending = false;
  private lastPushTime = 0;
  private pushTimeout: ReturnType<typeof setTimeout> | null = null;
  private pendingStoryId: string | null = null;
  private readonly PUSH_THROTTLE_MS = 10000; // Max one push every 10 seconds

  constructor() {
    // Ensure metadata index exists and is up-to-date
    // Run in background - don't block service initialization
    this.ensureMetadataIndexExists().catch(err => {
      console.error('[StoryService] Failed to ensure metadata index exists:', err);
    });
  }

  /**
   * Ensure metadata index exists and rebuild if necessary
   * This runs on service initialization to maintain index integrity
   */
  private async ensureMetadataIndexExists(): Promise<void> {
    try {
      // Try to get the index - this will create it if missing
      await this.metadataIndexService.getMetadataIndex();
    } catch (error) {
      // If there's an error, log it but don't try to rebuild
      // The new safety check in rebuildIndex prevents creating empty indexes
      // that would overwrite remote data during sync
      console.warn('[StoryService] Metadata index not available:', error);
      console.info('[StoryService] Index will be created automatically when stories are added');
      console.info('[StoryService] If sync is in progress, index will arrive shortly');
      // Don't throw - service should still work without index
    }
  }

  /**
   * Get all stories with optional pagination
   * @param limit Maximum number of stories to return (default: 50, max: 1000)
   * @param skip Number of stories to skip for pagination (default: 0)
   * @returns Array of stories
   */
  async getAllStories(limit?: number, skip?: number): Promise<Story[]> {
    try {
      // ALWAYS get fresh database reference - don't cache it
      // The database can change when user logs in/out
      const db = await this.databaseService.getDatabase();

      // Use allDocs with include_docs - faster than find() for small datasets
      const result = await db.allDocs({
        include_docs: true,
        // Explicitly include deleted docs to see if they're the issue
        // (we'll filter them out later if needed)
      });

      const stories = result.rows
        .filter((row) => {
          const doc = row.doc as unknown;
          if (!doc) {
            return false;
          }

          const docWithType = doc as Partial<Story> & {
            type?: string;
            content?: string;
          };

          // Filter out design docs
          if (docWithType._id && docWithType._id.startsWith('_design')) {
            return false;
          }

          // If document has a type field, it's not a story (stories don't have type field)
          if (docWithType.type) {
            return false; // This filters out codex, video, image-video-association, etc.
          }

          // Must have chapters (identifies story documents)
          if (!docWithType.chapters) {
            return false;
          }

          // Must have an ID
          if (!docWithType.id && !docWithType._id) {
            return false;
          }

          // Additional validation: Check if it's an empty/abandoned story
          if (this.isEmptyStory(docWithType)) {
            return false;
          }

          return true;
        })
        .map((row) => this.migrateStory(row.doc as Story));

      // Sort stories by order field (if exists) or by updatedAt (descending)
      stories.sort((a, b) => {
        // If both have order, sort by order (ascending)
        if (a.order !== undefined && b.order !== undefined) {
          return a.order - b.order;
        }
        // If only one has order, it comes first
        if (a.order !== undefined) return -1;
        if (b.order !== undefined) return 1;
        // Otherwise sort by updatedAt (descending - newest first)
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      });

      // Apply pagination in memory (simpler and faster than indexed queries for small datasets)
      const skipCount = skip || 0;
      const limitCount = Math.min(limit || 50, 1000);
      const paginatedStories = stories.slice(skipCount, skipCount + limitCount);

      return paginatedStories;
    } catch (error) {
      console.error('Error fetching stories:', error);
      return [];
    }
  }

  /**
   * Get total count of stories (for pagination)
   * Uses lightweight allDocs query
   */
  async getTotalStoriesCount(): Promise<number> {
    try {
      // ALWAYS get fresh database reference - don't cache it
      const db = await this.databaseService.getDatabase();

      // Use allDocs without include_docs for fastest count
      const result = await db.allDocs();

      // Use shared utility function for consistent story document filtering
      const storyCount = countStories(result.rows);

      return storyCount;
    } catch (error) {
      console.error('Error counting stories:', error);
      return 0;
    }
  }

  async getStory(id: string): Promise<Story | null> {
    try {
      this.db = await this.databaseService.getDatabase();
      // Try to get by _id first, then by id
      let doc;
      try {
        doc = await this.db.get(id);
      } catch (error) {
        if ((error as { status?: number }).status === 404) {
          // Try to find by id field
          const result = await this.db.find({
            selector: { id: id }
          });
          if (result.docs && result.docs.length > 0) {
            doc = result.docs[0];
          } else {
            return null;
          }
        } else {
          throw error;
        }
      }
      const migrated = this.migrateStory(doc as Story);
      return migrated;
    } catch (error) {
      console.error('Error getting story:', error);
      return null;
    }
  }

  async createStory(language: StoryLanguage = 'en', narrativePerspective?: NarrativePerspective, tense?: StoryTense): Promise<Story> {
    this.db = await this.databaseService.getDatabase();
    
    const firstChapter: Chapter = {
      id: this.generateId(),
      title: 'Chapter 1',
      order: 1,
      chapterNumber: 1,
      scenes: [{
        id: this.generateId(),
        title: 'Scene 1',
        content: '',
        order: 1,
        sceneNumber: 1,
        createdAt: new Date(),
        updatedAt: new Date()
      }],
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const storyId = this.generateId();
    
    // Load language-specific templates and default beat rules
    const [systemMessage, beatTemplate, defaultBeatRules] = await Promise.all([
      getSystemMessage(language),
      getBeatGenerationTemplate(language),
      getDefaultBeatRules(language)
    ]);
    
    const deviceInfo = this.deviceService.getDeviceInfo();

    const newStory: Story = {
      _id: storyId,
      id: storyId,
      title: '',
      chapters: [firstChapter],
      settings: {
        ...DEFAULT_STORY_SETTINGS,
        systemMessage: systemMessage,
        beatGenerationTemplate: beatTemplate,
        beatRules: defaultBeatRules,
        language: language,
        ...(narrativePerspective && { narrativePerspective }),
        ...(tense && { tense })
      },
      schemaVersion: CURRENT_SCHEMA_VERSION, // Mark as current version
      // Don't set order here - let it be undefined so it appears at top with latest updatedAt
      createdAt: new Date(),
      updatedAt: new Date(),
      lastModifiedBy: {
        deviceId: deviceInfo.deviceId,
        deviceName: deviceInfo.deviceName,
        timestamp: new Date()
      }
    };

    try {
      const response = await this.db.put(newStory);
      newStory._rev = response.rev;

      // Update metadata index with new story
      // Run in background - don't block story creation
      this.metadataIndexService.updateStoryMetadata(newStory).catch(err => {
        console.error('[StoryService] Failed to update metadata index after creation:', err);
      });

      return newStory;
    } catch (error) {
      console.error('Error creating story:', error);
      throw error;
    }
  }

  async updateStory(updatedStory: Story): Promise<void> {
    try {
      this.db = await this.databaseService.getDatabase();
      // Ensure we have the latest revision
      const currentDoc = await this.db.get(updatedStory._id || updatedStory.id);
      updatedStory._rev = (currentDoc as { _rev: string })._rev;
      updatedStory._id = updatedStory._id || updatedStory.id;

      // Ensure schema version is set when saving (for legacy stories)
      if (!updatedStory.schemaVersion) {
        updatedStory.schemaVersion = CURRENT_SCHEMA_VERSION;
      }

      // Track device modification
      const deviceInfo = this.deviceService.getDeviceInfo();
      updatedStory.lastModifiedBy = {
        deviceId: deviceInfo.deviceId,
        deviceName: deviceInfo.deviceName,
        timestamp: new Date()
      };

      await this.db.put(updatedStory);

      // Update metadata index with updated story
      // Run in background - don't block story updates
      this.metadataIndexService.updateStoryMetadata(updatedStory).catch(err => {
        console.error('[StoryService] Failed to update metadata index after update:', err);
      });

      // Manually trigger sync push - PouchDB live sync with filters doesn't push local changes
      this.scheduleSyncPush(updatedStory._id || updatedStory.id);
    } catch (error) {
      console.error('Error updating story:', error);
      throw error;
    }
  }

  /**
   * Schedule a throttled sync push after story saves.
   * Required because PouchDB live sync with filter functions doesn't detect local changes.
   */
  private scheduleSyncPush(storyId: string): void {
    this.pendingStoryId = storyId;

    const now = Date.now();
    const timeSinceLastPush = now - this.lastPushTime;

    if (timeSinceLastPush < this.PUSH_THROTTLE_MS) {
      if (!this.pushPending) {
        this.pushPending = true;
        const delay = this.PUSH_THROTTLE_MS - timeSinceLastPush;
        this.pushTimeout = setTimeout(() => this.executeSyncPush(), delay);
      }
      return;
    }

    this.executeSyncPush();
  }

  private executeSyncPush(): void {
    const storyId = this.pendingStoryId;
    this.pushPending = false;
    this.pushTimeout = null;
    this.pendingStoryId = null;
    this.lastPushTime = Date.now();

    if (!storyId) return;

    // Only push story document - metadata index is synced via live sync
    // when updateStoryMetadata() writes to local DB
    this.databaseService.pushDocuments([storyId]).then(result => {
      if (result.docsProcessed > 0) {
        console.info(`[StoryService] Pushed story ${storyId}: ${result.docsProcessed} docs`);
      }
    }).catch(err => {
      console.warn('[StoryService] Push failed (live sync will retry):', err);
    });
  }

  async deleteStory(id: string): Promise<void> {
    try {
      this.db = await this.databaseService.getDatabase();
      const remoteDb = this.databaseService.getRemoteDatabase();

      let doc: PouchDB.Core.IdMeta & PouchDB.Core.GetMeta | null = null;
      let targetDb: PouchDB.Database = this.db;

      // Try local database first
      try {
        doc = await this.db.get(id);
      } catch (error) {
        if ((error as { status?: number }).status === 404) {
          // Try to find by id field in local
          const result = await this.db.find({
            selector: { id: id }
          });
          if (result.docs && result.docs.length > 0) {
            doc = result.docs[0] as PouchDB.Core.IdMeta & PouchDB.Core.GetMeta;
          }
        } else {
          throw error;
        }
      }

      // If not found locally, try remote database
      // This handles the case where story is shown from metadata index but not synced locally
      if (!doc && remoteDb) {
        console.info('[StoryService] Story not found locally, trying remote database...');
        try {
          doc = await remoteDb.get(id);
          targetDb = remoteDb;
        } catch (error) {
          if ((error as { status?: number }).status === 404) {
            // Try to find by id field in remote
            const result = await remoteDb.find({
              selector: { id: id }
            });
            if (result.docs && result.docs.length > 0) {
              doc = result.docs[0] as PouchDB.Core.IdMeta & PouchDB.Core.GetMeta;
              targetDb = remoteDb;
            }
          } else {
            throw error;
          }
        }
      }

      if (!doc) {
        // Story not found anywhere - just remove from metadata index and return
        console.warn('[StoryService] Story not found in any database, removing from metadata index only');
        await this.metadataIndexService.removeStoryMetadata(id);
        return;
      }

      // Get the story ID for cleanup operations
      const storyId = (doc as Story).id || id;

      // Delete all associated beat version histories (only if deleting from local)
      if (targetDb === this.db) {
        try {
          await this.beatHistoryService.deleteAllHistoriesForStory(storyId);
        } catch (historyError) {
          // Log but don't fail the story deletion if history cleanup fails
          console.error('[StoryService] Failed to delete beat histories:', historyError);
        }
      }

      await targetDb.remove(doc);
      console.info(`[StoryService] Story deleted from ${targetDb === this.db ? 'local' : 'remote'} database`);

      // Remove story from metadata index - await to ensure UI updates immediately
      try {
        await this.metadataIndexService.removeStoryMetadata(storyId);
      } catch (err) {
        // Log but don't fail the overall deletion
        console.error('[StoryService] Failed to remove story from metadata index:', err);
      }
    } catch (error) {
      console.error('Error deleting story:', error);
      throw error;
    }
  }

  // Migration helper for old stories
  private migrateStory(story: Partial<Story>): Story {
    // Performance optimization: Skip migration if already at current schema version
    if (story.schemaVersion === CURRENT_SCHEMA_VERSION) {
      // Story is already migrated, just ensure Date objects are proper
      const result = {
        ...story,
        id: story.id || 'story-' + Date.now(),
        title: story.title || 'Untitled Story',
        chapters: story.chapters || [],
        createdAt: story.createdAt ? new Date(story.createdAt) : new Date(),
        updatedAt: story.updatedAt ? new Date(story.updatedAt) : new Date()
      } as Story;

      // Ensure lastModifiedBy timestamp is a Date object
      if (result.lastModifiedBy?.timestamp) {
        result.lastModifiedBy = {
          ...result.lastModifiedBy,
          timestamp: new Date(result.lastModifiedBy.timestamp)
        };
      }

      return result;
    }

    const migrated: Story = {
      id: story.id || 'story-' + Date.now(),
      title: story.title || 'Untitled Story',
      chapters: story.chapters || [],
      ...story,
      createdAt: story.createdAt ? new Date(story.createdAt) : new Date(),
      updatedAt: story.updatedAt ? new Date(story.updatedAt) : new Date()
    };

    // Ensure _id is set
    if (!migrated._id && migrated.id) {
      migrated._id = migrated.id;
    }

    // Add default settings if not present or merge missing fields
    if (!migrated.settings) {
      migrated.settings = { ...DEFAULT_STORY_SETTINGS };
    } else {
      // Ensure all new settings fields are present
      migrated.settings = {
        ...DEFAULT_STORY_SETTINGS,
        ...migrated.settings
      };
      
      // Migrate old beatTemplate to beatGenerationTemplate if needed
      const settingsAny = migrated.settings as { beatTemplate?: unknown };
      if (settingsAny.beatTemplate && !migrated.settings.beatGenerationTemplate) {
        migrated.settings.beatGenerationTemplate = DEFAULT_STORY_SETTINGS.beatGenerationTemplate;
      }
      
      // Remove old beatTemplate field
      delete settingsAny.beatTemplate;

      if (!Array.isArray(migrated.settings.favoriteModels)) {
        migrated.settings.favoriteModels = [];
      }

      const existingLists = migrated.settings.favoriteModelLists ?? {};
      const beatInputList = Array.isArray(existingLists.beatInput)
        ? existingLists.beatInput
        : migrated.settings.favoriteModels;
      const sceneSummaryList = Array.isArray(existingLists.sceneSummary)
        ? existingLists.sceneSummary
        : [];
      const rewriteList = Array.isArray(existingLists.rewrite)
        ? existingLists.rewrite
        : [];
      const characterChatList = Array.isArray(existingLists.characterChat)
        ? existingLists.characterChat
        : [];

      migrated.settings.favoriteModelLists = {
        beatInput: [...(beatInputList ?? [])],
        sceneSummary: [...sceneSummaryList],
        rewrite: [...rewriteList],
        characterChat: [...characterChatList]
      };
    }

    // If old story format with content field, migrate to chapter/scene structure
    if (story.content && !story.chapters) {
      const firstChapter: Chapter = {
        id: this.generateId(),
        title: 'Chapter 1',
        order: 1,
        chapterNumber: 1,
        scenes: [{
          id: this.generateId(),
          title: 'Scene 1',
          content: story.content,
          order: 1,
          sceneNumber: 1,
          createdAt: story.createdAt ? new Date(story.createdAt) : new Date(),
          updatedAt: story.updatedAt ? new Date(story.updatedAt) : new Date()
        }],
        createdAt: story.createdAt ? new Date(story.createdAt) : new Date(),
        updatedAt: story.updatedAt ? new Date(story.updatedAt) : new Date()
      };
      
      migrated.chapters = [firstChapter];
      delete migrated.content;
      
      // Migration will be automatically saved when story is next updated
    }

    // Ensure chapters have proper date objects and number fields
    if (migrated.chapters) {
      migrated.chapters = migrated.chapters.map((chapter, chapterIndex) => ({
        ...chapter,
        chapterNumber: chapter.chapterNumber || chapterIndex + 1,
        createdAt: new Date(chapter.createdAt),
        updatedAt: new Date(chapter.updatedAt),
        scenes: chapter.scenes.map((scene, sceneIndex) => ({
          ...scene,
          sceneNumber: scene.sceneNumber || sceneIndex + 1,
          createdAt: new Date(scene.createdAt),
          updatedAt: new Date(scene.updatedAt),
          summaryGeneratedAt: scene.summaryGeneratedAt ? new Date(scene.summaryGeneratedAt) : undefined,
          // Migrate beat IDs from legacy data-id to data-beat-id
          content: this.migrateBeatIds(scene.content)
        }))
      }));
    }

    // Ensure lastModifiedBy timestamp is a Date object
    if (migrated.lastModifiedBy?.timestamp) {
      migrated.lastModifiedBy = {
        ...migrated.lastModifiedBy,
        timestamp: new Date(migrated.lastModifiedBy.timestamp)
      };
    }

    // Set schema version to mark this story as migrated
    migrated.schemaVersion = CURRENT_SCHEMA_VERSION;

    return migrated;
  }

  // Chapter operations
  async addChapter(storyId: string, title = ''): Promise<Chapter> {
    this.db = await this.databaseService.getDatabase();
    const story = await this.getStory(storyId);
    if (!story) throw new Error('Story not found');

    const chapterNumber = story.chapters.length + 1;
    const newChapter: Chapter = {
      id: this.generateId(),
      title: title || `Chapter ${chapterNumber}`,
      order: chapterNumber,
      chapterNumber: chapterNumber,
      scenes: [{
        id: this.generateId(),
        title: 'Scene 1',
        content: '',
        order: 1,
        sceneNumber: 1,
        createdAt: new Date(),
        updatedAt: new Date()
      }],
      createdAt: new Date(),
      updatedAt: new Date()
    };

    story.chapters.push(newChapter);
    story.updatedAt = new Date();
    await this.updateStory(story);
    
    return newChapter;
  }

  async updateChapter(storyId: string, chapterId: string, updates: Partial<Chapter>): Promise<void> {
    this.db = await this.databaseService.getDatabase();
    const story = await this.getStory(storyId);
    if (!story) return;

    const chapterIndex = story.chapters.findIndex(c => c.id === chapterId);
    if (chapterIndex === -1) return;

    story.chapters[chapterIndex] = {
      ...story.chapters[chapterIndex],
      ...updates,
      updatedAt: new Date()
    };
    story.updatedAt = new Date();
    await this.updateStory(story);
  }

  async deleteChapter(storyId: string, chapterId: string): Promise<void> {
    this.db = await this.databaseService.getDatabase();
    const story = await this.getStory(storyId);
    if (!story) return;

    story.chapters = story.chapters.filter(c => c.id !== chapterId);
    // Reorder remaining chapters and update chapter numbers
    story.chapters.forEach((chapter, index) => {
      chapter.order = index + 1;
      chapter.chapterNumber = index + 1;
    });
    story.updatedAt = new Date();
    await this.updateStory(story);
  }

  // Scene operations
  async addScene(storyId: string, chapterId: string, title = ''): Promise<Scene> {
    this.db = await this.databaseService.getDatabase();
    const story = await this.getStory(storyId);
    if (!story) throw new Error('Story not found');

    const chapter = story.chapters.find(c => c.id === chapterId);
    if (!chapter) throw new Error('Chapter not found');

    const sceneNumber = chapter.scenes.length + 1;
    const newScene: Scene = {
      id: this.generateId(),
      title: title || `Scene ${sceneNumber}`,
      content: '',
      order: sceneNumber,
      sceneNumber: sceneNumber,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    chapter.scenes.push(newScene);
    chapter.updatedAt = new Date();
    story.updatedAt = new Date();
    await this.updateStory(story);
    
    return newScene;
  }

  async updateScene(storyId: string, chapterId: string, sceneId: string, updates: Partial<Scene>): Promise<void> {
    this.db = await this.databaseService.getDatabase();
    const story = await this.getStory(storyId);
    if (!story) return;

    const chapter = story.chapters.find(c => c.id === chapterId);
    if (!chapter) return;

    const sceneIndex = chapter.scenes.findIndex(s => s.id === sceneId);
    if (sceneIndex === -1) return;

    chapter.scenes[sceneIndex] = {
      ...chapter.scenes[sceneIndex],
      ...updates,
      updatedAt: new Date()
    };
    chapter.updatedAt = new Date();
    story.updatedAt = new Date();
    await this.updateStory(story);
  }

  async deleteScene(storyId: string, chapterId: string, sceneId: string): Promise<void> {
    this.db = await this.databaseService.getDatabase();
    const story = await this.getStory(storyId);
    if (!story) return;

    const chapter = story.chapters.find(c => c.id === chapterId);
    if (!chapter) return;

    chapter.scenes = chapter.scenes.filter(s => s.id !== sceneId);
    // Reorder remaining scenes and update scene numbers
    chapter.scenes.forEach((scene, index) => {
      scene.order = index + 1;
      scene.sceneNumber = index + 1;
    });
    chapter.updatedAt = new Date();
    story.updatedAt = new Date();
    await this.updateStory(story);
  }

  async getScene(storyId: string, chapterId: string, sceneId: string): Promise<Scene | null> {
    this.db = await this.databaseService.getDatabase();
    const story = await this.getStory(storyId);
    if (!story) return null;

    const chapter = story.chapters.find(c => c.id === chapterId);
    if (!chapter) return null;

    return chapter.scenes.find(s => s.id === sceneId) || null;
  }

  private generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substring(2);
  }

  /**
   * Check if a story is considered "empty" and should be filtered out
   */
  private isEmptyStory(story: Partial<Story> & { content?: string }): boolean {
    // Check if story has no title or just whitespace
    const hasNoTitle = !story.title || story.title.trim() === '';
    
    // Check creation date - filter out very recent empty stories (last 24 hours)
    const isRecent = story.createdAt ? 
      (Date.now() - new Date(story.createdAt).getTime()) < 24 * 60 * 60 * 1000 : false;
    
    // For legacy stories with content field
    if (story.content !== undefined) {
      const hasNoContent = !story.content || this.stripHtmlTags(story.content).trim() === '';
      // Only filter if BOTH no title AND no content AND recent
      return hasNoTitle && hasNoContent && isRecent;
    }
    
    // For new chapter/scene structure
    if (Array.isArray(story.chapters)) {
      // Check if any scene has content
      const hasContentInScenes = story.chapters.some((chapter: Chapter) => 
        chapter.scenes && chapter.scenes.some((scene: Scene) => {
          const cleanContent = this.stripHtmlTags(scene.content || '').trim();
          return cleanContent.length > 0;
        })
      );
      
      // Check if it has meaningful structure (more than default single empty scene)
      const hasOnlyDefaultStructure = story.chapters.length === 1 && 
        story.chapters[0].scenes && 
        story.chapters[0].scenes.length === 1 &&
        !this.stripHtmlTags(story.chapters[0].scenes[0].content || '').trim();
      
      // Filter out if: no title AND (no content OR only default structure) AND recent
      return hasNoTitle && (!hasContentInScenes || hasOnlyDefaultStructure) && isRecent;
    }
    
    // If no chapters and no content, consider empty
    return true;
  }

  /**
   * Migrate beat IDs from legacy data-id to data-beat-id attribute
   * and ensure all beats have an ID
   */
  private migrateBeatIds(html: string): string {
    if (!html) return html;

    // Use DOMParser to safely parse and manipulate HTML
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    // Find all beat elements
    const beatElements = doc.querySelectorAll('.beat-ai-node');

    beatElements.forEach(element => {
      const dataId = element.getAttribute('data-id');
      const dataBeatId = element.getAttribute('data-beat-id');

      // Case 1: Has data-id but not data-beat-id - migrate from legacy
      if (dataId && !dataBeatId) {
        element.setAttribute('data-beat-id', dataId);
        element.removeAttribute('data-id');
      }
      // Case 2: Has both - remove legacy data-id
      else if (dataId && dataBeatId) {
        element.removeAttribute('data-id');
      }
      // Case 3: Has neither - generate new ID
      else if (!dataId && !dataBeatId) {
        const newId = this.generateId();
        element.setAttribute('data-beat-id', newId);
      }
      // Case 4: Has data-beat-id only - already correct, do nothing
    });

    // Also migrate non-beat elements with data-id (for completeness)
    const elementsWithDataId = doc.querySelectorAll('[data-id]:not(.beat-ai-node)');
    elementsWithDataId.forEach(element => {
      const dataId = element.getAttribute('data-id');
      if (dataId) {
        element.setAttribute('data-beat-id', dataId);
        element.removeAttribute('data-id');
      }
    });

    // Return the migrated HTML
    return doc.body.innerHTML;
  }

  /**
   * Strip HTML tags from content for content checking
   */
  private stripHtmlTags(html: string): string {
    if (!html) return '';

    // Remove Beat AI nodes completely (they are editor-only components)
    const cleanHtml = html.replace(/<div[^>]*class="beat-ai-node"[^>]*>.*?<\/div>/gs, '');

    // Use DOMParser for safe HTML parsing instead of innerHTML
    const parser = new DOMParser();
    const doc = parser.parseFromString(cleanHtml, 'text/html');

    // Get text content safely
    const textContent = doc.body.textContent || '';

    // Remove any remaining Beat AI artifacts
    return textContent
      .replace(/🎭\s*Beat\s*AI/gi, '')
      .replace(/Prompt:\s*/gi, '')
      .replace(/BeatAIPrompt/gi, '')
      .trim()
      .replace(/\s+/g, ' '); // Normalize whitespace
  }

  /**
   * Get story preview with caching for performance
   */
  getStoryPreview(story: Story): string {
    const cacheKey = this.getStoryCacheKey(story);

    // Check cache first
    if (this.previewCache.has(cacheKey)) {
      return this.previewCache.get(cacheKey)!;
    }

    // Compute preview
    let preview = 'No content yet...';

    // For legacy stories with content
    if (story.content) {
      const cleanContent = this.stripHtmlTags(story.content);
      preview = cleanContent.length > 150 ? cleanContent.substring(0, 150) + '...' : cleanContent;
    } else if (story.chapters && story.chapters.length > 0 && story.chapters[0].scenes && story.chapters[0].scenes.length > 0) {
      // For new chapter/scene structure
      const firstScene = story.chapters[0].scenes[0];
      const content = firstScene.content || '';
      const cleanContent = this.stripHtmlTags(content);
      preview = cleanContent.length > 150 ? cleanContent.substring(0, 150) + '...' : cleanContent;
    }

    // Cache the result
    this.previewCache.set(cacheKey, preview);
    return preview;
  }

  /**
   * Get word count with caching for performance
   */
  getWordCount(story: Story): number {
    const cacheKey = this.getStoryCacheKey(story);

    // Check cache first
    if (this.wordCountCache.has(cacheKey)) {
      return this.wordCountCache.get(cacheKey)!;
    }

    // Compute word count
    let totalWords = 0;

    // For legacy stories with content
    if (story.content) {
      const cleanContent = this.stripHtmlTags(story.content);
      totalWords = cleanContent.trim().split(/\s+/).filter(word => word.length > 0).length;
    } else if (story.chapters) {
      // For new chapter/scene structure - count all scenes
      story.chapters.forEach(chapter => {
        if (chapter.scenes) {
          chapter.scenes.forEach(scene => {
            const content = scene.content || '';
            const cleanContent = this.stripHtmlTags(content);
            totalWords += cleanContent.trim().split(/\s+/).filter(word => word.length > 0).length;
          });
        }
      });
    }

    // Cache the result
    this.wordCountCache.set(cacheKey, totalWords);
    return totalWords;
  }

  /**
   * Invalidate cache for a specific story (call when story is updated)
   */
  invalidateStoryCache(story: Story): void {
    const cacheKey = this.getStoryCacheKey(story);
    this.previewCache.delete(cacheKey);
    this.wordCountCache.delete(cacheKey);
  }

  /**
   * Clear all caches (useful when reloading all stories)
   */
  clearAllCaches(): void {
    this.previewCache.clear();
    this.wordCountCache.clear();
  }

  /**
   * Generate cache key for a story based on ID and updatedAt timestamp
   */
  private getStoryCacheKey(story: Story): string {
    const id = story._id || story.id;
    const timestamp = story.updatedAt instanceof Date
      ? story.updatedAt.getTime()
      : new Date(story.updatedAt).getTime();
    return `${id}-${timestamp}`;
  }

  // Reorder stories method
  async reorderStories(stories: Story[]): Promise<void> {
    try {
      this.db = await this.databaseService.getDatabase();

      // Update each story with new order field
      const bulkDocs = stories.map((story, index) => ({
        ...story,
        order: index, // Save the array index as the order
        updatedAt: story.updatedAt // Keep original updatedAt
      }));

      await this.db.bulkDocs(bulkDocs);

      // Update metadata index for all reordered stories
      // Run in background - don't block reordering
      Promise.all(
        bulkDocs.map(story =>
          this.metadataIndexService.updateStoryMetadata(story as Story)
            .catch(err => {
              console.error(`[StoryService] Failed to update metadata index for story ${story.id}:`, err);
            })
        )
      ).catch(err => {
        console.error('[StoryService] Failed to update metadata index after reordering:', err);
      });
    } catch (error) {
      console.error('Error reordering stories:', error);
      throw error;
    }
  }

  // Helper methods for formatting chapter and scene displays
  formatChapterDisplay(chapter: Chapter): string {
    return `C${chapter.chapterNumber || chapter.order}:${chapter.title}`;
  }

  formatSceneDisplay(chapter: Chapter, scene: Scene): string {
    const chapterNum = chapter.chapterNumber || chapter.order;
    const sceneNum = scene.sceneNumber || scene.order;
    return `C${chapterNum}S${sceneNum}:${scene.title}`;
  }
}
