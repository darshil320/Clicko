import type { Configuration } from 'react-native-mmkv';

/**
 * How the app opens its one MMKV store (ADR-0025 D7, security review M1 in ADR-0024).
 *
 * - Web (development only): the plain store. SecureStore has no web backend.
 * - iOS/Android: an AES-256 store whose random key sits in the Keychain/Keystore, readable only on
 *   this device while it is unlocked. A backup or a device transfer carries ciphertext, not the key.
 * - An install from before D7 has a plain store. Its key-values are copied into the encrypted store
 *   once, the plain file is scrubbed, and the next launch deletes it.
 *
 * Pure: every native call is passed in, so the decision runs under Vitest.
 */

/** The MMKV calls this needs; react-native-mmkv's `MMKV` satisfies it. */
export interface KvHandle<Self> {
  readonly isEncrypted: boolean;
  set(key: string, value: string): void;
  contains(key: string): boolean;
  remove(key: string): boolean;
  clearAll(): void;
  importAllFrom(other: Self): number;
}

export type KvOpenConfig = Pick<Configuration, 'id' | 'encryptionKey' | 'encryptionType'>;

export interface KvNative<S extends KvHandle<S>> {
  /** `Platform.OS`. */
  readonly os: string;
  /** The stored key, or null when there is none. Throws when one exists but cannot be read now. */
  readKey(): string | null;
  /** Stores a new key. Throws when it cannot. */
  writeKey(key: string): void;
  /** Cryptographically secure random bytes. */
  randomBytes(length: number): Uint8Array;
  open(config: KvOpenConfig): S;
  exists(id: string): boolean;
  /** Deletes a store's files. Only ever called for an id not opened in this process. */
  destroy(id: string): boolean;
}

export interface KvIds {
  /** The pre-D7 plaintext store; still the store on web. */
  readonly plain: string;
  readonly encrypted: string;
}

/** MMKV's limit: an AES-256 key is at most 32 bytes. */
export const KEY_LENGTH = 32;
/**
 * 64 ASCII symbols, so each character is one byte to MMKV and `byte & 63` is unbiased:
 * 32 characters carry 192 random bits. (Raw bytes cannot be used: the key crosses JSI as a UTF-8
 * string, and any byte above 0x7f would grow to two bytes and break the 32-byte limit.)
 */
const KEY_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const KEY_FORMAT = /^[A-Za-z0-9_-]{32}$/;

/** Set in the encrypted store once the plain store is copied: the next launch deletes the plain file. */
export const PLAIN_COPIED = 'clickco.kv.plain-copied';
export const SCRUB_KEY = 'clickco.kv.scrub';
/** Larger than the first page MMKV keeps when it clears a file (4–16 KiB on phones). */
export const SCRUB_BYTES = 64 * 1024;

/** The Keychain/Keystore could not be used. The store stays closed rather than open unencrypted. */
export class KvKeyUnavailableError extends Error {
  override readonly name = 'KvKeyUnavailableError';

  constructor(action: 'read' | 'save', cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(`Could not ${action} the storage key in the Keychain/Keystore: ${detail}`, { cause });
  }
}

export function newEncryptionKey(randomBytes: (length: number) => Uint8Array): string {
  const bytes = randomBytes(KEY_LENGTH);
  if (bytes.length !== KEY_LENGTH) throw new Error('The random source returned the wrong length');
  return Array.from(bytes, (byte) => KEY_ALPHABET.charAt(byte & 63)).join('');
}

export function openKv<S extends KvHandle<S>>(ids: KvIds, native: KvNative<S>): S {
  if (native.os === 'web') return native.open({ id: ids.plain });

  const key = readKey(native) ?? createKey(ids.encrypted, native);
  const store = native.open({ id: ids.encrypted, encryptionKey: key, encryptionType: 'AES-256' });
  if (!store.isEncrypted) throw new Error(`MMKV opened "${ids.encrypted}" without encryption`);
  retirePlainStore(store, ids.plain, native);
  return store;
}

/** null: no usable key. A value we did not write (malformed) cannot open the store either. */
function readKey<S extends KvHandle<S>>(native: KvNative<S>): string | null {
  let stored: string | null;
  try {
    stored = native.readKey();
  } catch (error) {
    throw new KvKeyUnavailableError('read', error);
  }
  return stored !== null && KEY_FORMAT.test(stored) ? stored : null;
}

/**
 * No key: a fresh install, an install from before D7, or a backup restored onto another phone (the
 * key never leaves the device it was made on). An encrypted file left behind can never be read
 * again, so it is deleted instead of being opened with a new key.
 */
function createKey<S extends KvHandle<S>>(encryptedId: string, native: KvNative<S>): string {
  if (native.exists(encryptedId)) native.destroy(encryptedId);
  const key = newEncryptionKey(native.randomBytes);
  try {
    native.writeKey(key);
  } catch (error) {
    throw new KvKeyUnavailableError('save', error);
  }
  return key;
}

/**
 * Moves a pre-D7 plain store into the encrypted one without a window that loses data: the plain
 * file stays until a later launch, so a crash at any step just repeats the copy.
 *
 * It is not deleted in the launch that copies it: react-native-mmkv keeps a raw pointer to every
 * instance it opened and calls it on each return to the foreground, and MMKV's removeStorage()
 * frees an open instance. So this launch scrubs it, and the next launch, which never opens it,
 * deletes it.
 */
function retirePlainStore<S extends KvHandle<S>>(
  store: S,
  plainId: string,
  native: KvNative<S>,
): void {
  if (!native.exists(plainId)) return;
  if (store.contains(PLAIN_COPIED)) {
    if (native.destroy(plainId)) store.remove(PLAIN_COPIED);
    return;
  }
  const plain = native.open({ id: plainId });
  store.importAllFrom(plain);
  store.set(PLAIN_COPIED, '1');
  scrub(plain);
}

/**
 * MMKV's clearAll() only cuts the file back to its first page and zeroes the length header: the old
 * key-values would still sit in that page, in plaintext, until the file is deleted. With the store
 * empty, one large write starts at the top of the file and overwrites that page; clearAll() then
 * empties it again.
 */
function scrub<S extends KvHandle<S>>(plain: S): void {
  plain.clearAll();
  plain.set(SCRUB_KEY, 'x'.repeat(SCRUB_BYTES));
  plain.clearAll();
}
