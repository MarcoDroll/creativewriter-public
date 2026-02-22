import { Injectable, inject } from '@angular/core';
import { v4 as uuidv4 } from 'uuid';
import { DatabaseService } from '../../core/services/database.service';
import { StoryResearchDoc, StoryResearchSceneFinding, StoryResearchStatus } from '../models/story-research.interface';

@Injectable({ providedIn: 'root' })
export class StoryResearchService {
  private readonly databaseService = inject(DatabaseService);
  private db: PouchDB.Database | null = null;

  // Sync push throttling — PouchDB live sync with filters doesn't push local changes
  private pushTimeout: ReturnType<typeof setTimeout> | null = null;
  private lastPushTime = 0;
  private pendingDocIds = new Set<string>();
  private readonly PUSH_THROTTLE_MS = 5000;

  private readonly DOC_PREFIX = 'story-research_';
  private readonly MAX_RESEARCHES_PER_STORY = 5;

  private async ensureDb(): Promise<PouchDB.Database> {
    if (!this.db) this.db = await this.databaseService.getDatabase();
    return this.db;
  }

  async listResearch(storyId: string): Promise<StoryResearchDoc[]> {
    const db = await this.ensureDb();
    const result = await db.allDocs({
      include_docs: true,
      startkey: `${this.DOC_PREFIX}${storyId}_`,
      endkey: `${this.DOC_PREFIX}${storyId}_\ufff0`
    });

    const docs: StoryResearchDoc[] = [];
    for (const row of result.rows) {
      if (!row.doc) continue;
      const doc = row.doc as Record<string, unknown>;
      if ((doc as { type?: string }).type !== 'story-research') continue;
      docs.push(this.deserialize(doc));
    }

    docs.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    return docs;
  }

  async getResearch(storyId: string, researchId: string): Promise<StoryResearchDoc | null> {
    const db = await this.ensureDb();
    const _id = `${this.DOC_PREFIX}${storyId}_${researchId}`;
    try {
      const raw = await db.get(_id);
      return this.deserialize(raw as Record<string, unknown>);
    } catch (error) {
      if ((error as { status?: number }).status === 404) return null;
      throw error;
    }
  }

  async deleteResearch(storyId: string, researchId: string): Promise<void> {
    const db = await this.ensureDb();
    const _id = `${this.DOC_PREFIX}${storyId}_${researchId}`;
    try {
      const existing = await db.get(_id);
      await db.remove(existing);
      this.schedulePush(_id);
    } catch (error) {
      if ((error as { status?: number }).status === 404) return;
      throw error;
    }
  }

  async saveResearch(params: {
    storyId: string;
    task: string;
    model: string;
    sceneFindings: StoryResearchSceneFinding[];
    summary?: string;
    status?: StoryResearchStatus;
    errorMessage?: string;
    researchId?: string | null;
  }): Promise<StoryResearchDoc> {
    const db = await this.ensureDb();
    const now = new Date();
    const researchId = params.researchId || uuidv4();
    const _id = `${this.DOC_PREFIX}${params.storyId}_${researchId}`;

    let existing: Record<string, unknown> | null = null;
    try {
      existing = await db.get(_id);
    } catch (error) {
      if ((error as { status?: number }).status !== 404) throw error;
    }

    const doc: StoryResearchDoc & Record<string, unknown> = {
      _id,
      type: 'story-research',
      storyId: params.storyId,
      researchId,
      task: params.task,
      model: params.model,
      sceneFindings: params.sceneFindings,
      summary: params.summary,
      status: params.status || 'completed',
      errorMessage: params.errorMessage,
      createdAt: existing && typeof existing['createdAt'] === 'string'
        ? new Date(existing['createdAt'] as string)
        : now,
      updatedAt: now
    };

    if (existing && '_rev' in existing && typeof (existing as { _rev: string })._rev === 'string') {
      doc._rev = (existing as { _rev: string })._rev;
    }

    const serialized = this.serialize(doc);
    const response = await db.put(serialized);
    doc._rev = response.rev;
    this.schedulePush(_id);

    await this.enforceLimit(params.storyId);

    return this.deserialize(doc as unknown as Record<string, unknown>);
  }

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
        console.info(`[StoryResearchService] Pushed ${result.docsProcessed} docs`);
      }
    }).catch(err => {
      console.warn('[StoryResearchService] Push failed (live sync will retry):', err);
    });
  }

  private serialize(doc: StoryResearchDoc & Record<string, unknown>): Record<string, unknown> {
    return {
      ...doc,
      createdAt: new Date(doc.createdAt).toISOString(),
      updatedAt: new Date(doc.updatedAt).toISOString(),
      sceneFindings: doc.sceneFindings.map(finding => ({ ...finding }))
    };
  }

  private deserialize(raw: Record<string, unknown>): StoryResearchDoc {
    return {
      ...(raw as object),
      createdAt: new Date(raw['createdAt'] as string),
      updatedAt: new Date(raw['updatedAt'] as string),
      sceneFindings: Array.isArray(raw['sceneFindings'])
        ? (raw['sceneFindings'] as unknown[]).map(item => {
            const entry = item as Record<string, unknown>;
            return {
              chapterId: String(entry['chapterId'] ?? ''),
              sceneId: String(entry['sceneId'] ?? ''),
              chapterTitle: entry['chapterTitle'] ? String(entry['chapterTitle']) : undefined,
              sceneTitle: entry['sceneTitle'] ? String(entry['sceneTitle']) : undefined,
              prompt: String(entry['prompt'] ?? ''),
              response: String(entry['response'] ?? '')
            };
          })
        : [],
      errorMessage: raw['errorMessage'] ? String(raw['errorMessage']) : undefined
    } as StoryResearchDoc;
  }

  private async enforceLimit(storyId: string): Promise<void> {
    const docs = await this.listResearch(storyId);
    if (docs.length <= this.MAX_RESEARCHES_PER_STORY) return;
    const toPrune = docs.slice(this.MAX_RESEARCHES_PER_STORY);
    const db = await this.ensureDb();
    for (const doc of toPrune) {
      try {
        const raw = await db.get(doc._id);
        await db.remove(raw);
        this.schedulePush(doc._id);
      } catch {
        void 0;
      }
    }
  }
}
