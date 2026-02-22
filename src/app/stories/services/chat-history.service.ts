import { Injectable, inject } from '@angular/core';
import { v4 as uuidv4 } from 'uuid';
import { DatabaseService } from '../../core/services/database.service';
import { ChatHistoryDoc, ChatHistoryMessage, ChatHistoryContextSceneRef } from '../models/chat-history.interface';

@Injectable({ providedIn: 'root' })
export class ChatHistoryService {
  private readonly databaseService = inject(DatabaseService);
  private db: PouchDB.Database | null = null;

  // Sync push throttling — PouchDB live sync with filters doesn't push local changes
  private pushTimeout: ReturnType<typeof setTimeout> | null = null;
  private lastPushTime = 0;
  private pendingDocIds = new Set<string>();
  private readonly PUSH_THROTTLE_MS = 5000;

  private readonly DOC_PREFIX = 'scene-chat_';
  private readonly MAX_HISTORIES_PER_STORY = 5;

  private async ensureDb(): Promise<PouchDB.Database> {
    if (!this.db) this.db = await this.databaseService.getDatabase();
    return this.db;
  }

  async listHistories(storyId: string): Promise<ChatHistoryDoc[]> {
    const db = await this.ensureDb();
    const res = await db.allDocs({
      include_docs: true,
      startkey: `${this.DOC_PREFIX}${storyId}_`,
      endkey: `${this.DOC_PREFIX}${storyId}_\ufff0`
    });

    const docs: ChatHistoryDoc[] = [];
    for (const row of res.rows) {
      if (!row.doc) continue;
      const doc = row.doc as Record<string, unknown>;
      if ((doc as { type?: string }).type !== 'scene-chat') continue;
      docs.push(this.deserialize(doc));
    }

    docs.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    return docs;
  }

  async getLatest(storyId: string): Promise<ChatHistoryDoc | null> {
    const list = await this.listHistories(storyId);
    return list.length ? list[0] : null;
  }

  async saveSnapshot(params: {
    storyId: string;
    messages: ChatHistoryMessage[];
    selectedScenes?: ChatHistoryContextSceneRef[];
    includeStoryOutline?: boolean;
    includeCodexContext?: boolean;
    selectedModel?: string;
    historyId?: string | null;
    title?: string;
  }): Promise<ChatHistoryDoc> {
    const db = await this.ensureDb();
    const now = new Date();
    const historyId = params.historyId || uuidv4();
    const _id = `${this.DOC_PREFIX}${params.storyId}_${historyId}`;

    let existing: Record<string, unknown> | null = null;
    try {
      existing = await db.get(_id);
    } catch (e: unknown) {
      if (e && typeof e === 'object' && 'status' in e && (e as { status?: number }).status !== 404) throw e;
    }

    const doc: ChatHistoryDoc & Record<string, unknown> = {
      _id,
      type: 'scene-chat',
      storyId: params.storyId,
      historyId,
      title: params.title,
      messages: params.messages.map(m => ({ ...m, timestamp: new Date(m.timestamp) })),
      selectedScenes: params.selectedScenes || [],
      includeStoryOutline: !!params.includeStoryOutline,
      includeCodexContext: !!params.includeCodexContext,
      selectedModel: params.selectedModel,
      createdAt: (existing && 'createdAt' in existing && typeof (existing as Record<string, unknown>)['createdAt'] === 'string')
        ? new Date((existing as Record<string, unknown>)['createdAt'] as string)
        : now,
      updatedAt: now
    };
    if (existing && '_rev' in existing && typeof (existing as { _rev?: string })._rev === 'string') {
      doc._rev = (existing as { _rev: string })._rev;
    }

    // Serialize dates to ISO strings
    const toSave = this.serialize(doc);
    const putRes = await db.put(toSave);
    doc._rev = putRes.rev;
    this.schedulePush(_id);

    // Enforce max histories per story
    await this.enforceLimit(params.storyId);

    return this.deserialize(doc as unknown as Record<string, unknown>);
  }

  async deleteHistory(storyId: string, historyId: string): Promise<void> {
    const db = await this.ensureDb();
    const _id = `${this.DOC_PREFIX}${storyId}_${historyId}`;
    try {
      const doc = await db.get(_id);
      await db.remove(doc);
      this.schedulePush(_id);
    } catch (e: unknown) {
      if (e && typeof e === 'object' && 'status' in e && (e as { status?: number }).status === 404) return;
      throw e as Error;
    }
  }

  private async enforceLimit(storyId: string): Promise<void> {
    const db = await this.ensureDb();
    const docs = await this.listHistories(storyId);
    if (docs.length <= this.MAX_HISTORIES_PER_STORY) return;
    const toDelete = docs.slice(this.MAX_HISTORIES_PER_STORY); // oldest beyond limit
    for (const d of toDelete) {
      try {
        const raw = await db.get(d._id);
        await db.remove(raw);
        this.schedulePush(d._id);
      } catch {
        void 0;
      }
    }
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
        console.info(`[ChatHistoryService] Pushed ${result.docsProcessed} docs`);
      }
    }).catch(err => {
      console.warn('[ChatHistoryService] Push failed (live sync will retry):', err);
    });
  }

  private serialize(doc: ChatHistoryDoc & Record<string, unknown>): Record<string, unknown> {
    return {
      ...doc,
      createdAt: new Date(doc.createdAt).toISOString(),
      updatedAt: new Date(doc.updatedAt).toISOString(),
      messages: doc.messages.map(m => ({
        ...m,
        timestamp: new Date(m.timestamp).toISOString()
      })),
      selectedScenes: (doc.selectedScenes || []).map(s => ({ ...s }))
    };
  }

  private deserialize(raw: Record<string, unknown>): ChatHistoryDoc {
    return {
      ...(raw as object),
      createdAt: new Date(raw['createdAt'] as string),
      updatedAt: new Date(raw['updatedAt'] as string),
      messages: Array.isArray(raw['messages'])
        ? (raw['messages'] as unknown[]).map(m => {
            const mm = m as Record<string, unknown>;
            return {
              role: (mm['role'] as 'user' | 'assistant'),
              content: String(mm['content'] ?? ''),
              timestamp: new Date(mm['timestamp'] as string),
              isPresetPrompt: Boolean(mm['isPresetPrompt'] as boolean),
              extractionType: mm['extractionType'] as ('characters' | 'locations' | 'objects' | undefined)
            } as ChatHistoryMessage;
          })
        : [],
      selectedScenes: Array.isArray(raw['selectedScenes'])
        ? (raw['selectedScenes'] as unknown[]).map(s => {
            const ss = s as Record<string, unknown>;
            const out: ChatHistoryContextSceneRef = {
              chapterId: String(ss['chapterId'] ?? ''),
              sceneId: String(ss['sceneId'] ?? ''),
              chapterTitle: ss['chapterTitle'] ? String(ss['chapterTitle']) : undefined,
              sceneTitle: ss['sceneTitle'] ? String(ss['sceneTitle']) : undefined
            };
            return out;
          })
        : []
    } as ChatHistoryDoc;
  }
}
