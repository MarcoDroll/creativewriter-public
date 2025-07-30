import { Injectable, inject } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { v4 as uuidv4 } from 'uuid';
import { Codex, CodexCategory, CodexEntry, DEFAULT_CODEX_CATEGORIES } from '../models/codex.interface';
import { DatabaseService } from '../../core/services/database.service';

@Injectable({
  providedIn: 'root'
})
export class CodexService {
  private databaseService = inject(DatabaseService);

  private codexMap = new Map<string, Codex>();
  private codexSubject = new BehaviorSubject<Map<string, Codex>>(new Map());
  private db: any;
  private isInitialized = false;
  
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
      const result = await this.db.allDocs({
        include_docs: true,
        startkey: 'codex_',
        endkey: 'codex_\ufff0'
      });
      
      this.codexMap.clear();
      
      for (const row of result.rows) {
        if (row.doc && row.doc.type === 'codex') {
          const codex = this.deserializeCodex(row.doc);
          this.codexMap.set(codex.storyId, codex);
        }
      }
      
      this.codexSubject.next(new Map(this.codexMap));
    } catch (error) {
      console.error('Error loading codex from database:', error);
    }
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
          let docToUpdate: any;
          try {
            docToUpdate = await this.db.get(docId);
          } catch (error: any) {
            if (error.status === 404) {
              // Document doesn't exist, create new one
              docToUpdate = {
                _id: docId,
                type: 'codex'
              };
            } else {
              throw error;
            }
          }
          
          // Merge with the latest document, preserving _rev
          const updatedDoc = {
            ...docToUpdate,
            ...codex,
            _id: docId,
            type: 'codex',
            _rev: docToUpdate._rev // Preserve revision
          };
          
          await this.db.put(updatedDoc);
          
          // Update local map and notify subscribers
          this.codexMap.set(codex.storyId, codex);
          this.codexSubject.next(new Map(this.codexMap));
          
          break; // Success, exit retry loop
          
        } catch (error: any) {
          if (error.status === 409 && attempt < maxRetries - 1) {
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


  private deserializeCodex(codex: any): Codex {
    return {
      ...codex,
      createdAt: new Date(codex.createdAt),
      updatedAt: new Date(codex.updatedAt),
      categories: codex.categories.map((cat: any) => ({
        ...cat,
        createdAt: new Date(cat.createdAt),
        updatedAt: new Date(cat.updatedAt),
        entries: cat.entries.map((entry: any) => ({
          ...entry,
          createdAt: new Date(entry.createdAt),
          updatedAt: new Date(entry.updatedAt)
        }))
      }))
    };
  }

  // Create or get codex for a story
  async getOrCreateCodex(storyId: string): Promise<Codex> {
    if (!this.isInitialized) {
      await this.waitForInitialization();
    }
    
    let codex = this.codexMap.get(storyId);
    
    if (!codex) {
      codex = await this.createCodex(storyId);
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
      const latestDoc = await this.db.get(docId);
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
        imageUrl: entry.imageUrl,
        metadata: entry.metadata || {},
        customFields: entry.customFields || [],
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
      
    } catch (error: any) {
      if (error.status === 404) {
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
          imageUrl: entry.imageUrl,
          metadata: entry.metadata || {},
          customFields: entry.customFields || [],
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
      const latestDoc = await this.db.get(docId);
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
      const latestDoc = await this.db.get(docId);
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
        const doc = await this.db.get(docId);
        await this.db.remove(doc);
      } catch (error: any) {
        if (error.status !== 404) {
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
}