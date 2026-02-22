declare namespace PouchDB {
  interface PutResponse {
    ok: boolean;
    id: string;
    rev: string;
  }

  interface AllDocsOptions {
    include_docs?: boolean;
    keys?: string[];
    startkey?: string;
    endkey?: string;
    limit?: number;
    skip?: number;
    descending?: boolean;
  }

  interface AllDocsResponse<T = unknown> {
    total_rows: number;
    offset: number;
    rows: {
      id: string;
      key: string;
      value: { rev: string };
      doc?: T;
    }[];
  }

  interface FindOptions {
    selector: Record<string, unknown>;
    fields?: string[];
    sort?: Record<string, string>[];
    limit?: number;
    skip?: number;
  }

  interface FindResponse<T = unknown> {
    docs: T[];
    warning?: string;
  }

  interface IndexOptions {
    index: {
      fields: string[];
      name?: string;
      type?: string;
    };
  }

  interface InfoResponse {
    db_name: string;
    doc_count: number;
    update_seq: number;
    purge_seq?: number;
    compact_running: boolean;
    disk_size: number;
    data_size: number;
    instance_start_time: string;
    disk_format_version: number;
    committed_update_seq: number;
  }

  interface SyncOptions {
    live?: boolean;
    retry?: boolean;
    filter?: string | ((doc: unknown) => boolean);
    doc_ids?: string[];
    query_params?: Record<string, unknown>;
    view?: string;
    since?: number;
    heartbeat?: number;
    timeout?: number;
    batch_size?: number;
    batches_limit?: number;
    back_off_function?: (delay: number) => number;
  }

  interface Database {
    put<T = unknown>(doc: T): Promise<PutResponse>;
    get<T = unknown>(id: string): Promise<T>;
    remove<T = unknown>(doc: T): Promise<PutResponse>;
    allDocs<T = unknown>(options?: AllDocsOptions): Promise<AllDocsResponse<T>>;
    find<T = unknown>(options: FindOptions): Promise<FindResponse<T>>;
    createIndex(options: IndexOptions): Promise<{ result: string }>;
    info(): Promise<InfoResponse>;
    compact(): Promise<void>;
    destroy(): Promise<void>;
    close(): Promise<void>;
    sync(target: Database, options?: SyncOptions): Replication.Sync<unknown>;
    replicate: {
      to(target: Database): Promise<Replication.SyncResult<unknown>>;
      from(target: Database): Promise<Replication.SyncResult<unknown>>;
    };
    bulkDocs<T = unknown>(docs: T[]): Promise<PutResponse[]>;
    getAttachment(docId: string, attachmentId: string): Promise<Blob>;
    putAttachment(docId: string, attachmentId: string, attachment: Blob, type: string): Promise<PutResponse>;
    removeAttachment(docId: string, attachmentId: string, rev: string): Promise<PutResponse>;
    name?: string;
  }

  namespace Configuration {
    interface DatabaseConfiguration {
      adapter?: string;
      auth?: {
        username: string;
        password: string;
      };
      skip_setup?: boolean;
    }
  }

  namespace Core {
    interface Error {
      status?: number;
      message?: string;
      error?: boolean;
      reason?: string;
    }

    interface Document {
      _id?: string;
      _rev?: string;
      [key: string]: unknown;
    }

    interface ExistingDocument extends Document {
      _id: string;
      _rev: string;
    }
  }

  namespace Replication {
    interface SyncResult<T = unknown> {
      direction?: string;
      change?: {
        docs: T[];
      };
    }

    interface Sync<T = unknown> {
      on(event: string, handler: (info: unknown) => void): Sync<T>;
      off(event: string, handler?: (info: unknown) => void): Sync<T>;
      cancel(): void;
    }
  }
}

// Use module-bundled PouchDB; avoid declaring a global runtime constructor.
// Ambient namespace types remain available for typing in the app.
