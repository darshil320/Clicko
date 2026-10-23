import type { UploadFileKind } from '@clickco/contracts';

/**
 * Upload checkpoints (doc 02 §7 "Checkpointed"): which parts and files of a session finished, kept
 * in IndexedDB so closing the tab never restarts an 18 GB upload. The server's session stays the
 * truth on resume; the checkpoint is what lets the portal offer "Resume" and match files again.
 */

export interface CheckpointFile {
  readonly clientFileId: string;
  readonly name: string;
  readonly size: number;
  readonly lastModified: number;
  readonly kind: UploadFileKind;
}

export interface Checkpoint {
  readonly sessionId: string;
  readonly bookingId: string;
  readonly photographerId: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly files: readonly CheckpointFile[];
  /** clientFileId → part numbers acknowledged by the server. */
  readonly doneParts: Readonly<Record<string, readonly number[]>>;
  readonly verifiedFiles: readonly string[];
}

export interface CheckpointStore {
  load(sessionId: string): Promise<Checkpoint | null>;
  save(checkpoint: Checkpoint): Promise<void>;
  remove(sessionId: string): Promise<void>;
  /** This photographer's unfinished uploads for a booking (newest first). */
  forBooking(photographerId: string, bookingId: string): Promise<Checkpoint[]>;
}

export function withPartDone(
  c: Checkpoint,
  clientFileId: string,
  partNumber: number,
  at: number,
): Checkpoint {
  const done = c.doneParts[clientFileId] ?? [];
  if (done.includes(partNumber)) return c;
  return {
    ...c,
    updatedAt: at,
    doneParts: { ...c.doneParts, [clientFileId]: [...done, partNumber] },
  };
}

export function withFileVerified(c: Checkpoint, clientFileId: string, at: number): Checkpoint {
  if (c.verifiedFiles.includes(clientFileId)) return c;
  return { ...c, updatedAt: at, verifiedFiles: [...c.verifiedFiles, clientFileId] };
}

export function withFileRestarted(c: Checkpoint, clientFileId: string, at: number): Checkpoint {
  const { [clientFileId]: _dropped, ...rest } = c.doneParts;
  return { ...c, updatedAt: at, doneParts: rest };
}

/** For tests and browsers without IndexedDB (private windows on some browsers). */
export class MemoryCheckpointStore implements CheckpointStore {
  private readonly items = new Map<string, Checkpoint>();

  async load(sessionId: string) {
    return this.items.get(sessionId) ?? null;
  }

  async save(checkpoint: Checkpoint) {
    this.items.set(checkpoint.sessionId, checkpoint);
  }

  async remove(sessionId: string) {
    this.items.delete(sessionId);
  }

  async forBooking(photographerId: string, bookingId: string) {
    return [...this.items.values()]
      .filter((c) => c.photographerId === photographerId && c.bookingId === bookingId)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }
}

const DB_NAME = 'clickco-portal';
const STORE = 'upload-checkpoints';

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

/** IndexedDB-backed store (browser only). */
export class IndexedDbCheckpointStore implements CheckpointStore {
  private db: Promise<IDBDatabase> | null = null;

  private open(): Promise<IDBDatabase> {
    if (!this.db) {
      this.db = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
          if (!req.result.objectStoreNames.contains(STORE)) {
            req.result.createObjectStore(STORE, { keyPath: 'sessionId' });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error('IndexedDB unavailable'));
      });
    }
    return this.db;
  }

  private async store(mode: IDBTransactionMode): Promise<IDBObjectStore> {
    return (await this.open()).transaction(STORE, mode).objectStore(STORE);
  }

  async load(sessionId: string): Promise<Checkpoint | null> {
    return (
      ((await request((await this.store('readonly')).get(sessionId))) as Checkpoint | undefined) ??
      null
    );
  }

  async save(checkpoint: Checkpoint): Promise<void> {
    await request((await this.store('readwrite')).put(checkpoint));
  }

  async remove(sessionId: string): Promise<void> {
    await request((await this.store('readwrite')).delete(sessionId));
  }

  async forBooking(photographerId: string, bookingId: string): Promise<Checkpoint[]> {
    const all = (await request((await this.store('readonly')).getAll())) as Checkpoint[];
    return all
      .filter((c) => c.photographerId === photographerId && c.bookingId === bookingId)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }
}

/** IndexedDB when the browser has it, memory otherwise (the server state still allows resuming). */
export function browserCheckpointStore(): CheckpointStore {
  return typeof indexedDB === 'undefined'
    ? new MemoryCheckpointStore()
    : new IndexedDbCheckpointStore();
}
