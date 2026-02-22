import { Injectable, inject } from '@angular/core';
import { v4 as uuidv4 } from 'uuid';
import { DatabaseService } from '../../core/services/database.service';
import { CharacterChatHistoryDoc, CharacterChatMessage } from '../models/chat-history.interface';

@Injectable({ providedIn: 'root' })
export class CharacterChatHistoryService {
  private readonly databaseService = inject(DatabaseService);
  private db: PouchDB.Database | null = null;

  // Sync push throttling — PouchDB live sync with filters doesn't push local changes
  private pushTimeout: ReturnType<typeof setTimeout> | null = null;
  private lastPushTime = 0;
  private pendingDocIds = new Set<string>();
  private readonly PUSH_THROTTLE_MS = 5000;

  private readonly DOC_PREFIX = 'character-chat_';
  private readonly MAX_HISTORIES_PER_CHARACTER = 5;

  private async ensureDb(): Promise<PouchDB.Database> {
    if (!this.db) this.db = await this.databaseService.getDatabase();
    return this.db;
  }

  /**
   * List all chat histories for a specific character
   */
  async listHistoriesForCharacter(storyId: string, characterId: string): Promise<CharacterChatHistoryDoc[]> {
    const db = await this.ensureDb();
    const res = await db.allDocs({
      include_docs: true,
      startkey: `${this.DOC_PREFIX}${storyId}_${characterId}_`,
      endkey: `${this.DOC_PREFIX}${storyId}_${characterId}_\ufff0`
    });

    const docs: CharacterChatHistoryDoc[] = [];
    for (const row of res.rows) {
      if (!row.doc) continue;
      const doc = row.doc as Record<string, unknown>;
      if ((doc as { type?: string }).type !== 'character-chat') continue;
      docs.push(this.deserialize(doc));
    }

    docs.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    return docs;
  }

  /**
   * Get the latest chat history for a character
   */
  async getLatestForCharacter(storyId: string, characterId: string): Promise<CharacterChatHistoryDoc | null> {
    const list = await this.listHistoriesForCharacter(storyId, characterId);
    return list.length ? list[0] : null;
  }

  /**
   * Save a snapshot of the current chat
   */
  async saveSnapshot(params: {
    storyId: string;
    characterId: string;
    characterName: string;
    messages: CharacterChatMessage[];
    selectedModel?: string;
    knowledgeCutoff?: { chapterOrder: number; sceneOrder?: number };
    historyId?: string | null;
    title?: string;
  }): Promise<CharacterChatHistoryDoc> {
    const db = await this.ensureDb();
    const now = new Date();
    const historyId = params.historyId || uuidv4();
    const _id = `${this.DOC_PREFIX}${params.storyId}_${params.characterId}_${historyId}`;

    let existing: Record<string, unknown> | null = null;
    try {
      existing = await db.get(_id);
    } catch (e: unknown) {
      if (e && typeof e === 'object' && 'status' in e && (e as { status?: number }).status !== 404) throw e;
    }

    const doc: CharacterChatHistoryDoc & Record<string, unknown> = {
      _id,
      type: 'character-chat',
      storyId: params.storyId,
      characterId: params.characterId,
      characterName: params.characterName,
      historyId,
      title: params.title,
      messages: params.messages.map(m => ({ ...m, timestamp: new Date(m.timestamp) })),
      selectedModel: params.selectedModel,
      knowledgeCutoff: params.knowledgeCutoff,
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

    // Enforce max histories per character
    await this.enforceLimit(params.storyId, params.characterId);

    return this.deserialize(doc as unknown as Record<string, unknown>);
  }

  /**
   * Delete a specific chat history
   */
  async deleteHistory(storyId: string, characterId: string, historyId: string): Promise<void> {
    const db = await this.ensureDb();
    const _id = `${this.DOC_PREFIX}${storyId}_${characterId}_${historyId}`;
    try {
      const doc = await db.get(_id);
      await db.remove(doc);
      this.schedulePush(_id);
    } catch (e: unknown) {
      if (e && typeof e === 'object' && 'status' in e && (e as { status?: number }).status === 404) return;
      throw e as Error;
    }
  }

  private async enforceLimit(storyId: string, characterId: string): Promise<void> {
    const db = await this.ensureDb();
    const docs = await this.listHistoriesForCharacter(storyId, characterId);
    if (docs.length <= this.MAX_HISTORIES_PER_CHARACTER) return;
    const toDelete = docs.slice(this.MAX_HISTORIES_PER_CHARACTER); // oldest beyond limit
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
        console.info(`[CharacterChatHistoryService] Pushed ${result.docsProcessed} docs`);
      }
    }).catch(err => {
      console.warn('[CharacterChatHistoryService] Push failed (live sync will retry):', err);
    });
  }

  private serialize(doc: CharacterChatHistoryDoc & Record<string, unknown>): Record<string, unknown> {
    return {
      ...doc,
      createdAt: new Date(doc.createdAt).toISOString(),
      updatedAt: new Date(doc.updatedAt).toISOString(),
      messages: doc.messages.map(m => ({
        ...m,
        timestamp: new Date(m.timestamp).toISOString()
      }))
    };
  }

  private deserialize(raw: Record<string, unknown>): CharacterChatHistoryDoc {
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
              timestamp: new Date(mm['timestamp'] as string)
            } as CharacterChatMessage;
          })
        : [],
      knowledgeCutoff: raw['knowledgeCutoff'] as { chapterOrder: number; sceneOrder?: number } | undefined
    } as CharacterChatHistoryDoc;
  }
}
