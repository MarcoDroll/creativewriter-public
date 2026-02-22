import { Injectable, inject } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { v4 as uuidv4 } from 'uuid';
import { Codex, CodexCategory, CodexEntry, DEFAULT_CODEX_CATEGORIES, PortraitGalleryItem } from '../models/codex.interface';
import { DatabaseService } from '../../core/services/database.service';

@Injectable({
  providedIn: 'root'
})
export class CodexService {
  private databaseService = inject(DatabaseService);

  private codexMap = new Map<string, Codex>();
  private codexSubject = new BehaviorSubject<Map<string, Codex>>(new Map());
  private db: PouchDB.Database | null = null;
  private isInitialized = false;

  // Sync push throttling - PouchDB live sync with filters doesn't push local changes
  // so we need to manually trigger push after saves (same pattern as StoryService)
  private pushTimeout: ReturnType<typeof setTimeout> | null = null;
  private lastPushTime = 0;
  private pendingDocIds = new Set<string>();
  private readonly PUSH_THROTTLE_MS = 5000;

  codex$ = this.codexSubject.asObservable();

  constructor() {
    this.initializeService();
  }

  private async initializeService(): Promise<void> {
    try {
      this.db = await this.databaseService.getDatabase();
      await this.loadFromDatabase();
      this.isInitialized = true;
    } catch (error) {
      console.error('Error initializing codex service:', error);
      throw error;
    }
  }

  private async waitForInitialization(): Promise<void> {
    if (this.isInitialized) return;
    
    // Wait for initialization with timeout
    const timeout = 5000;
    const start = Date.now();
    
    while (!this.isInitialized && (Date.now() - start) < timeout) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    if (!this.isInitialized) {
      throw new Error('Codex service initialization timeout');
    }
  }


  private async loadFromDatabase(): Promise<void> {
    try {
      const result = await this.db!.allDocs({
        include_docs: true,
        startkey: 'codex_',
        endkey: 'codex_\ufff0'
      });
      
      this.codexMap.clear();
      
      for (const row of result.rows) {
        if (row.doc && (row.doc as { type?: string }).type === 'codex') {
          const codex = this.deserializeCodex(row.doc);
          this.codexMap.set(codex.storyId, codex);
        }
      }
      
      this.codexSubject.next(new Map(this.codexMap));
    } catch (error) {
      console.error('Error loading codex from database:', error);
    }
  }

  /**
   * Reload a specific codex from the database.
   * Use this after force-replicating the codex document to ensure we have the latest version.
   * @param storyId The story ID whose codex should be reloaded
   * @returns The codex if found, undefined otherwise
   */
  async reloadCodexFromDatabase(storyId: string): Promise<Codex | undefined> {
    if (!this.isInitialized) {
      await this.waitForInitialization();
    }

    const docId = `codex_${storyId}`;

    try {
      const doc = await this.db!.get(docId);
      if (doc && (doc as { type?: string }).type === 'codex') {
        const codex = this.deserializeCodex(doc);
        this.codexMap.set(storyId, codex);
        this.codexSubject.next(new Map(this.codexMap));
        console.info(`[CodexService] Reloaded codex for story ${storyId} from database`);
        return codex;
      }
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'status' in error && (error as { status: number }).status === 404) {
        // Codex doesn't exist yet - this is normal for new stories
        console.info(`[CodexService] No codex found for story ${storyId} in database`);
        return undefined;
      }
      console.error(`[CodexService] Error reloading codex for story ${storyId}:`, error);
    }

    return undefined;
  }

  private async saveToDatabase(codex: Codex, maxRetries = 3): Promise<void> {
    try {
      if (!this.isInitialized) {
        await this.waitForInitialization();
      }
      
      const docId = `codex_${codex.storyId}`;
      
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
          // Always get the latest version before updating
          let docToUpdate: { _id: string; _rev?: string; [key: string]: unknown };
          try {
            docToUpdate = await this.db!.get(docId);
          } catch (error: unknown) {
            if (error && typeof error === 'object' && 'status' in error && (error as {status: number}).status === 404) {
              // Document doesn't exist, create new one
              docToUpdate = {
                _id: docId,
                type: 'codex'
              };
            } else {
              throw error;
            }
          }
          
          // Clean up the codex data to ensure no duplicate tags
          const cleanedCodex = this.cleanCodexData(codex);
          
          // Merge with the latest document, preserving _rev
          // But use cleaned codex to ensure no duplicate tags
          const updatedDoc = {
            ...docToUpdate,
            ...cleanedCodex,
            _id: docId,
            type: 'codex',
            _rev: docToUpdate._rev // Preserve revision for conflict resolution
          };
          
          await this.db!.put(updatedDoc);

          // Update local map and notify subscribers
          this.codexMap.set(codex.storyId, cleanedCodex);
          this.codexSubject.next(new Map(this.codexMap));

          // Push to remote (fire-and-forget with throttle)
          this.schedulePush(docId);

          break; // Success, exit retry loop
          
        } catch (error: unknown) {
          if ((error as PouchDB.Core.Error).status === 409 && attempt < maxRetries - 1) {
            // Conflict error, retry after a short delay
            console.warn(`Document conflict on attempt ${attempt + 1}, retrying...`);
            await new Promise(resolve => setTimeout(resolve, 100 * Math.pow(2, attempt))); // Exponential backoff
            // Continue to next iteration, which will reload the document
          } else {
            throw error;
          }
        }
      }
      
    } catch (error) {
      console.error('Error saving codex to database:', error);
      throw error;
    }
  }

  /**
   * Schedule a throttled sync push after codex saves.
   * Required because PouchDB live sync with filter functions doesn't detect local changes.
   */
  private schedulePush(docId: string): void {
    this.pendingDocIds.add(docId);
    const now = Date.now();
    const timeSinceLastPush = now - this.lastPushTime;
    if (timeSinceLastPush < this.PUSH_THROTTLE_MS) {
      if (this.pushTimeout) {
        clearTimeout(this.pushTimeout);
      }
      const delay = this.PUSH_THROTTLE_MS - timeSinceLastPush;
      this.pushTimeout = setTimeout(() => this.executePush(), delay);
      return;
    }
    this.executePush();
  }

  private executePush(): void {
    const docIds = [...this.pendingDocIds];
    this.pushTimeout = null;
    this.pendingDocIds.clear();
    this.lastPushTime = Date.now();
    if (docIds.length === 0) return;
    this.databaseService.pushDocuments(docIds).then(result => {
      if (result.docsProcessed > 0) {
        console.info(`[CodexService] Pushed ${result.docsProcessed} docs`);
      }
    }).catch(err => {
      console.warn('[CodexService] Push failed (live sync will retry):', err);
    });
  }

  private cleanCodexData(codex: Codex): Codex {
    // Only deep clone and process categories if they contain entries with tags
    // This is more efficient than always doing a full deep clone
    
    // Check if we need to clean anything
    const needsCleaning = codex.categories?.some(cat => 
      cat.entries?.some(entry => entry.tags && entry.tags.length > 0)
    );
    
    if (!needsCleaning) {
      return codex;
    }
    
    // Process categories and deduplicate tags
    return {
      ...codex,
      categories: codex.categories.map((category: CodexCategory) => ({
        ...category,
        entries: category.entries?.map((entry: CodexEntry) => ({
          ...entry,
          // Deduplicate tags if they exist
          tags: entry.tags ? [...new Set(entry.tags)] : []
        })) || []
      }))
    };
  }


  private deserializeCodex(codex: unknown): Codex {
    const typedCodex = codex as Codex & { createdAt: string | Date; updatedAt: string | Date };
    return {
      ...typedCodex,
      createdAt: new Date(typedCodex.createdAt),
      updatedAt: new Date(typedCodex.updatedAt),
      categories: typedCodex.categories.map((cat: CodexCategory & { createdAt: string | Date; updatedAt: string | Date }) => ({
        ...cat,
        createdAt: new Date(cat.createdAt),
        updatedAt: new Date(cat.updatedAt),
        entries: cat.entries.map((entry: CodexEntry & { createdAt: string | Date; updatedAt: string | Date }) =>
          this.migrateEntryPortraitToGallery({
            ...entry,
            createdAt: new Date(entry.createdAt),
            updatedAt: new Date(entry.updatedAt),
            // Deduplicate tags when deserializing from database
            tags: entry.tags ? [...new Set(entry.tags)] : [],
            // Deserialize portrait gallery dates if present
            portraitGallery: entry.portraitGallery?.map((p: PortraitGalleryItem & { createdAt: string | Date }) => ({
              ...p,
              createdAt: new Date(p.createdAt)
            }))
          })
        )
      }))
    };
  }

  /**
   * Migrate existing portraitBase64 to portrait gallery format
   */
  private migrateEntryPortraitToGallery(entry: CodexEntry & { portraitBase64?: string }): CodexEntry {
    // Skip if already has a gallery (already migrated)
    if (entry.portraitGallery !== undefined) {
      const { portraitBase64: _, ...cleanEntry } = entry;
      return cleanEntry;
    }

    // Check if there's an existing portrait to migrate
    if (entry.portraitBase64) {
      const migratedItem: PortraitGalleryItem = {
        id: uuidv4(),
        base64: entry.portraitBase64,
        createdAt: entry.updatedAt,
        source: 'uploaded' // Assume uploaded since we can't tell the original source
      };

      const { portraitBase64: _, ...cleanEntry } = entry;
      return {
        ...cleanEntry,
        portraitGallery: [migratedItem],
        activePortraitId: migratedItem.id
      };
    }

    // No portrait to migrate, initialize empty gallery
    const { portraitBase64: _, ...cleanEntry } = entry;
    return {
      ...cleanEntry,
      portraitGallery: [],
      activePortraitId: undefined
    };
  }

  /**
   * Get the active portrait base64 for an entry
   */
  getActivePortrait(entry: CodexEntry): string | null {
    if (!entry.portraitGallery || entry.portraitGallery.length === 0) {
      return null;
    }

    const activeId = entry.activePortraitId;
    const activePortrait = entry.portraitGallery.find(p => p.id === activeId);

    return activePortrait?.base64
      || entry.portraitGallery[0]?.base64
      || null;
  }

  // Create or get codex for a story
  async getOrCreateCodex(storyId: string): Promise<Codex> {
    if (!this.isInitialized) {
      await this.waitForInitialization();
    }
    
    let codex = this.codexMap.get(storyId);
    
    if (!codex) {
      codex = await this.createCodex(storyId);
    } else {
      // Migrate German category names to English if needed
      await this.migrateCategoryNamesToEnglish(storyId);
      // Refresh codex after potential migration
      codex = this.codexMap.get(storyId) || codex;
    }
    
    return codex;
  }

  // Create new codex with default categories
  private async createCodex(storyId: string): Promise<Codex> {
    const now = new Date();
    const codex: Codex = {
      id: uuidv4(),
      storyId,
      title: `Codex for Story ${storyId}`,
      categories: DEFAULT_CODEX_CATEGORIES.map((cat: Partial<CodexCategory>, index: number) => ({
        id: uuidv4(),
        title: cat.title!,
        description: cat.description,
        icon: cat.icon,
        order: index,
        entries: [],
        createdAt: now,
        updatedAt: now
      })),
      createdAt: now,
      updatedAt: now
    };

    await this.saveToDatabase(codex);
    return codex;
  }

  // Get codex by story ID
  getCodex(storyId: string): Codex | undefined {
    return this.codexMap.get(storyId);
  }

  /**
   * Set the in-memory cache for a codex.
   * Used by import functionality to update the cache after direct database insertion.
   */
  setCodexCache(storyId: string, codex: Codex): void {
    this.codexMap.set(storyId, codex);
    this.codexSubject.next(new Map(this.codexMap));
  }

  // Add category
  async addCategory(storyId: string, category: Partial<CodexCategory>): Promise<CodexCategory> {
    const codex = await this.getOrCreateCodex(storyId);
    const now = new Date();
    
    const newCategory: CodexCategory = {
      id: uuidv4(),
      title: category.title || 'New Category',
      description: category.description,
      icon: category.icon,
      order: codex.categories.length,
      entries: [],
      createdAt: now,
      updatedAt: now
    };

    // Create new codex instance with updated categories
    const updatedCodex: Codex = {
      ...codex,
      categories: [...codex.categories, newCategory],
      updatedAt: now
    };
    
    await this.saveToDatabase(updatedCodex);
    return newCategory;
  }

  // Update category
  async updateCategory(storyId: string, categoryId: string, updates: Partial<CodexCategory>): Promise<void> {
    const codex = this.codexMap.get(storyId);
    if (!codex) return;

    const category = codex.categories.find((c: CodexCategory) => c.id === categoryId);
    if (!category) return;

    Object.assign(category, updates, { updatedAt: new Date() });
    codex.updatedAt = new Date();
    
    await this.saveToDatabase(codex);
  }

  // Delete category
  async deleteCategory(storyId: string, categoryId: string): Promise<void> {
    const codex = this.codexMap.get(storyId);
    if (!codex) return;

    const now = new Date();
    
    // Create new codex with filtered categories
    const updatedCodex: Codex = {
      ...codex,
      categories: codex.categories.filter((c: CodexCategory) => c.id !== categoryId),
      updatedAt: now
    };
    
    await this.saveToDatabase(updatedCodex);
  }

  // Add entry to category
  async addEntry(storyId: string, categoryId: string, entry: Partial<CodexEntry>): Promise<CodexEntry> {
    // Always get the latest version from database to avoid conflicts
    const codex = await this.getOrCreateCodex(storyId);
    
    // Refresh codex from database before modification
    try {
      if (!this.isInitialized) {
        await this.waitForInitialization();
      }
      
      const docId = `codex_${storyId}`;
      const latestDoc = await this.db!.get(docId);
      const latestCodex = this.deserializeCodex(latestDoc);
      
      const category = latestCodex.categories.find((c: CodexCategory) => c.id === categoryId);
      
      if (!category) {
        throw new Error('Category not found');
      }

      const now = new Date();
      const newEntry: CodexEntry = {
        id: uuidv4(),
        categoryId,
        title: entry.title || 'New Entry',
        content: entry.content || '',
        tags: entry.tags || [],
        portraitGallery: entry.portraitGallery,
        activePortraitId: entry.activePortraitId,
        metadata: entry.metadata || {},
        storyRole: entry.storyRole,
        alwaysInclude: entry.alwaysInclude,
        order: category.entries.length,
        createdAt: now,
        updatedAt: now
      };

      // Create new category with updated entries
      const updatedCategory: CodexCategory = {
        ...category,
        entries: [...category.entries, newEntry],
        updatedAt: now
      };
      
      // Create new codex with updated category
      const updatedCodex: Codex = {
        ...latestCodex,
        categories: latestCodex.categories.map(c => c.id === categoryId ? updatedCategory : c),
        updatedAt: now
      };
      
      await this.saveToDatabase(updatedCodex);
      return newEntry;
      
    } catch (error: unknown) {
      if ((error as PouchDB.Core.Error).status === 404) {
        // Fallback to original logic if document doesn't exist
        const category = codex.categories.find((c: CodexCategory) => c.id === categoryId);
        
        if (!category) {
          throw new Error('Category not found');
        }

        const now = new Date();
        const newEntry: CodexEntry = {
          id: uuidv4(),
          categoryId,
          title: entry.title || 'New Entry',
          content: entry.content || '',
          tags: entry.tags || [],
          portraitGallery: entry.portraitGallery,
          activePortraitId: entry.activePortraitId,
          metadata: entry.metadata || {},
          storyRole: entry.storyRole,
          alwaysInclude: entry.alwaysInclude,
          order: category.entries.length,
          createdAt: now,
          updatedAt: now
        };

        const updatedCategory: CodexCategory = {
          ...category,
          entries: [...category.entries, newEntry],
          updatedAt: now
        };
        
        const updatedCodex: Codex = {
          ...codex,
          categories: codex.categories.map(c => c.id === categoryId ? updatedCategory : c),
          updatedAt: now
        };
        
        await this.saveToDatabase(updatedCodex);
        return newEntry;
      } else {
        throw error;
      }
    }
  }

  // Update entry
  async updateEntry(storyId: string, categoryId: string, entryId: string, updates: Partial<CodexEntry>): Promise<void> {
    // Always get the latest version from database
    try {
      if (!this.isInitialized) {
        await this.waitForInitialization();
      }
      
      const docId = `codex_${storyId}`;
      const latestDoc = await this.db!.get(docId);
      const codex = this.deserializeCodex(latestDoc);

      const category = codex.categories.find((c: CodexCategory) => c.id === categoryId);
      if (!category) return;

      const entryIndex = category.entries.findIndex((e: CodexEntry) => e.id === entryId);
      if (entryIndex === -1) return;

      const now = new Date();
      
      // Create updated entry
      const updatedEntry = {
        ...category.entries[entryIndex],
        ...updates,
        updatedAt: now
      };
      
      // Create new category with updated entry
      const updatedCategory: CodexCategory = {
        ...category,
        entries: category.entries.map((e, index) => index === entryIndex ? updatedEntry : e),
        updatedAt: now
      };
      
      // Create new codex with updated category
      const updatedCodex: Codex = {
        ...codex,
        categories: codex.categories.map(c => c.id === categoryId ? updatedCategory : c),
        updatedAt: now
      };
      
      await this.saveToDatabase(updatedCodex);
    } catch (error) {
      console.error('Error updating entry:', error);
      throw error;
    }
  }

  // Delete entry
  async deleteEntry(storyId: string, categoryId: string, entryId: string): Promise<void> {
    // Always get the latest version from database
    try {
      if (!this.isInitialized) {
        await this.waitForInitialization();
      }
      
      const docId = `codex_${storyId}`;
      const latestDoc = await this.db!.get(docId);
      const codex = this.deserializeCodex(latestDoc);

      const category = codex.categories.find((c: CodexCategory) => c.id === categoryId);
      if (!category) return;

      const now = new Date();
      
      // Create new category with filtered entries
      const updatedCategory: CodexCategory = {
        ...category,
        entries: category.entries.filter((e: CodexEntry) => e.id !== entryId),
        updatedAt: now
      };
      
      // Create new codex with updated category
      const updatedCodex: Codex = {
        ...codex,
        categories: codex.categories.map(c => c.id === categoryId ? updatedCategory : c),
        updatedAt: now
      };
      
      await this.saveToDatabase(updatedCodex);
    } catch (error) {
      console.error('Error deleting entry:', error);
      throw error;
    }
  }

  // Reorder categories
  async reorderCategories(storyId: string, categoryIds: string[]): Promise<void> {
    const codex = this.codexMap.get(storyId);
    if (!codex) return;

    const reorderedCategories = categoryIds
      .map((id, index) => {
        const category = codex.categories.find((c: CodexCategory) => c.id === id);
        if (category) {
          category.order = index;
        }
        return category;
      })
      .filter(Boolean) as CodexCategory[];

    codex.categories = reorderedCategories;
    codex.updatedAt = new Date();
    
    await this.saveToDatabase(codex);
  }

  // Reorder entries within a category
  async reorderEntries(storyId: string, categoryId: string, entryIds: string[]): Promise<void> {
    const codex = this.codexMap.get(storyId);
    if (!codex) return;

    const category = codex.categories.find((c: CodexCategory) => c.id === categoryId);
    if (!category) return;

    const reorderedEntries = entryIds
      .map((id, index) => {
        const entry = category.entries.find((e: CodexEntry) => e.id === id);
        if (entry) {
          entry.order = index;
        }
        return entry;
      })
      .filter(Boolean) as CodexEntry[];

    category.entries = reorderedEntries;
    category.updatedAt = new Date();
    codex.updatedAt = new Date();
    
    await this.saveToDatabase(codex);
  }

  // Delete entire codex for a story
  async deleteCodex(storyId: string): Promise<void> {
    try {
      if (!this.isInitialized) {
        await this.waitForInitialization();
      }
      
      const docId = `codex_${storyId}`;
      
      try {
        const doc = await this.db!.get(docId);
        await this.db!.remove(doc);
        // Push tombstone to remote so deletion syncs to other devices
        this.schedulePush(docId);
      } catch (error: unknown) {
        if ((error as PouchDB.Core.Error).status !== 404) {
          throw error;
        }
      }

      this.codexMap.delete(storyId);
      this.codexSubject.next(new Map(this.codexMap));
      
    } catch (error) {
      console.error('Error deleting codex from database:', error);
      throw error;
    }
  }

  // Search entries across all categories
  searchEntries(storyId: string, query: string): CodexEntry[] {
    const codex = this.codexMap.get(storyId);
    if (!codex) return [];

    const lowerQuery = query.toLowerCase();
    const results: CodexEntry[] = [];

    for (const category of codex.categories) {
      const matchingEntries = category.entries.filter((entry: CodexEntry) =>
        entry.title.toLowerCase().includes(lowerQuery) ||
        entry.content.toLowerCase().includes(lowerQuery) ||
        entry.tags?.some((tag: string) => tag.toLowerCase().includes(lowerQuery))
      );
      results.push(...matchingEntries);
    }

    return results;
  }

  // Get all codex entries for a story (for Beat AI prompts)
  getAllCodexEntries(storyId: string): { category: string; entries: CodexEntry[]; icon?: string }[] {
    const codex = this.codexMap.get(storyId);
    if (!codex) return [];

    return codex.categories
      .filter(category => category.entries.length > 0)
      .map(category => ({
        category: category.title,
        entries: [...category.entries].sort((a, b) => a.order - b.order),
        icon: category.icon
      }))
      .sort((a, b) => {
        const categoryA = codex.categories.find(c => c.title === a.category);
        const categoryB = codex.categories.find(c => c.title === b.category);
        return (categoryA?.order || 0) - (categoryB?.order || 0);
      });
  }

  // Migrate German category names to English
  async migrateCategoryNamesToEnglish(storyId: string): Promise<void> {
    const codex = this.codexMap.get(storyId);
    if (!codex) return;

    const categoryMapping = {
      // German -> English
      'charaktere': 'Characters',
      'charakter': 'Characters', 
      'figuren': 'Characters',
      'figur': 'Characters',
      'personen': 'Characters',
      'person': 'Characters',
      'orte': 'Locations',
      'ort': 'Locations',
      'schauplätze': 'Locations',
      'schauplatz': 'Locations',
      'objekte': 'Objects',
      'objekt': 'Objects',
      'gegenstände': 'Objects',
      'gegenstand': 'Objects',
      'notizen': 'Notes',
      'notiz': 'Notes',
      'anmerkungen': 'Notes',
      'anmerkung': 'Notes'
    };

    let hasChanges = false;
    const updatedCategories = codex.categories.map(category => {
      const lowerTitle = category.title.toLowerCase();
      const englishTitle = categoryMapping[lowerTitle as keyof typeof categoryMapping];
      
      if (englishTitle && category.title !== englishTitle) {
        hasChanges = true;
        return { ...category, title: englishTitle, updatedAt: new Date() };
      }
      return category;
    });

    if (hasChanges) {
      const updatedCodex: Codex = {
        ...codex,
        categories: updatedCategories,
        updatedAt: new Date()
      };

      await this.saveToDatabase(updatedCodex);
    }
  }
}