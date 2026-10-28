import { describe, expect, it } from 'vitest';
import {
  KEY_LENGTH,
  type KvHandle,
  KvKeyUnavailableError,
  type KvNative,
  type KvOpenConfig,
  newEncryptionKey,
  openKv,
  PLAIN_COPIED,
  SCRUB_BYTES,
  SCRUB_KEY,
} from './open-kv';

const IDS = { plain: 'clickco.client', encrypted: 'clickco.client.secure' } as const;

/** One MMKV file on disk: the key it was written with, and its key-values. */
interface FakeFile {
  readonly key: string | undefined;
  readonly data: Map<string, string>;
  /** Every write and clear, in order. */
  readonly ops: string[];
}

class FakeStore implements KvHandle<FakeStore> {
  constructor(
    readonly file: FakeFile,
    readonly isEncrypted: boolean,
  ) {}
  set(key: string, value: string): void {
    this.file.ops.push(`set ${key} (${value.length})`);
    this.file.data.set(key, value);
  }
  contains(key: string): boolean {
    return this.file.data.has(key);
  }
  remove(key: string): boolean {
    return this.file.data.delete(key);
  }
  clearAll(): void {
    this.file.ops.push('clearAll');
    this.file.data.clear();
  }
  importAllFrom(other: FakeStore): number {
    for (const [key, value] of other.file.data) this.file.data.set(key, value);
    return other.file.data.size;
  }
}

interface Device {
  readonly files: Map<string, FakeFile>;
  keychain: string | null;
}

interface LaunchOptions {
  readonly os?: string;
  readonly readKeyError?: Error;
  readonly writeKeyError?: Error;
  readonly destroyFails?: boolean;
  readonly opensUnencrypted?: boolean;
}

/** One app process on `device`. Mirrors the MMKV behaviour openKv relies on, and its hazards. */
function launch(device: Device, options: LaunchOptions = {}) {
  const opened = new Set<string>();
  const calls: string[] = [];
  const native: KvNative<FakeStore> = {
    os: options.os ?? 'ios',
    readKey: () => {
      calls.push('readKey');
      if (options.readKeyError) throw options.readKeyError;
      return device.keychain;
    },
    writeKey: (key) => {
      calls.push('writeKey');
      if (options.writeKeyError) throw options.writeKeyError;
      device.keychain = key;
    },
    randomBytes: (length) => Uint8Array.from({ length }, (_, i) => (i * 37 + 11) % 256),
    open: (config: KvOpenConfig) => {
      calls.push(`open ${config.id}`);
      const existing = device.files.get(config.id);
      // Real MMKV would fail its CRC check and discard the data: never let openKv get here.
      if (existing && existing.key !== config.encryptionKey) {
        throw new Error(`wrong key for ${config.id}`);
      }
      const file = existing ?? { key: config.encryptionKey, data: new Map(), ops: [] };
      device.files.set(config.id, file);
      opened.add(config.id);
      const encrypted = config.encryptionKey !== undefined && !options.opensUnencrypted;
      return new FakeStore(file, encrypted);
    },
    exists: (id) => device.files.has(id),
    destroy: (id) => {
      calls.push(`destroy ${id}`);
      // MMKV frees an open instance that react-native-mmkv still points at.
      if (opened.has(id)) throw new Error(`destroyed ${id} while it is open`);
      if (options.destroyFails) return false;
      return device.files.delete(id);
    },
  };
  return { native, calls, open: () => openKv(IDS, native) };
}

const newDevice = (): Device => ({ files: new Map(), keychain: null });

function withPlainStore(entries: Record<string, string>): Device {
  const data = new Map(Object.entries(entries));
  return { files: new Map([[IDS.plain, { key: undefined, data, ops: [] }]]), keychain: null };
}

const SESSION = JSON.stringify({ state: { tokens: { refreshToken: 'r-1' } }, version: 1 });
const DRAFT = JSON.stringify({ state: { venueAddress: '12 MG Road' }, version: 1 });

describe('openKv on web', () => {
  it('opens the plain store and never touches SecureStore', () => {
    const device = newDevice();
    const app = launch(device, { os: 'web' });
    const store = app.open();
    expect(store.isEncrypted).toBe(false);
    expect(app.calls).toEqual([`open ${IDS.plain}`]);
    expect(device.keychain).toBeNull();
  });
});

describe('openKv on a device', () => {
  it('creates a key on a fresh install and opens the store encrypted with AES-256', () => {
    const device = newDevice();
    const app = launch(device);
    const store = app.open();
    expect(store.isEncrypted).toBe(true);
    expect(device.keychain).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(device.files.get(IDS.encrypted)?.key).toBe(device.keychain);
    expect(device.files.has(IDS.plain)).toBe(false);
    expect(app.calls).toEqual(['readKey', 'writeKey', `open ${IDS.encrypted}`]);
  });

  it('reuses the stored key on the next launch and keeps the data', () => {
    const device = newDevice();
    launch(device).open().set('clickco.session', SESSION);
    const key = device.keychain;

    const next = launch(device);
    const store = next.open();
    expect(device.keychain).toBe(key);
    expect(next.calls).not.toContain('writeKey');
    expect(store.file.data.get('clickco.session')).toBe(SESSION);
  });

  it('re-encrypts a plain store once: everything is copied, the plain file is scrubbed', () => {
    const device = withPlainStore({ 'clickco.session': SESSION, 'clickco.booking-draft': DRAFT });
    const store = launch(device).open();

    expect(store.file.data.get('clickco.session')).toBe(SESSION);
    expect(store.file.data.get('clickco.booking-draft')).toBe(DRAFT);
    expect(store.contains(PLAIN_COPIED)).toBe(true);

    const plain = device.files.get(IDS.plain);
    expect(plain?.data.size).toBe(0);
    // Emptied first, so the large write lands at the top of the file over the old key-values.
    expect(plain?.ops).toEqual(['clearAll', `set ${SCRUB_KEY} (${SCRUB_BYTES})`, 'clearAll']);
    expect(store.file.data.has(SCRUB_KEY)).toBe(false);
  });

  it('deletes the copied plain file on the next launch, without opening it', () => {
    const device = withPlainStore({ 'clickco.session': SESSION });
    launch(device).open();
    expect(device.files.has(IDS.plain)).toBe(true);

    const next = launch(device);
    const store = next.open();
    expect(device.files.has(IDS.plain)).toBe(false);
    expect(next.calls).not.toContain(`open ${IDS.plain}`);
    expect(store.contains(PLAIN_COPIED)).toBe(false);
    expect(store.file.data.get('clickco.session')).toBe(SESSION);

    const third = launch(device);
    third.open();
    expect(third.calls).toEqual(['readKey', `open ${IDS.encrypted}`]);
  });

  it('keeps the marker and retries when deleting the plain file fails', () => {
    const device = withPlainStore({ 'clickco.session': SESSION });
    launch(device).open();
    const store = launch(device, { destroyFails: true }).open();
    expect(store.contains(PLAIN_COPIED)).toBe(true);
    launch(device).open();
    expect(device.files.has(IDS.plain)).toBe(false);
  });

  it('repeats the copy after a crash between saving the key and copying', () => {
    const device = withPlainStore({ 'clickco.session': SESSION });
    device.keychain = newEncryptionKey((length) => new Uint8Array(length).fill(7));

    const store = launch(device).open();
    expect(store.file.data.get('clickco.session')).toBe(SESSION);
    expect(store.contains(PLAIN_COPIED)).toBe(true);
  });

  it('repeats the whole copy after a crash part-way through it', () => {
    const device = withPlainStore({ 'clickco.session': SESSION, 'clickco.booking-draft': DRAFT });
    const key = newEncryptionKey((length) => new Uint8Array(length).fill(9));
    device.keychain = key;
    const partial = new Map([['clickco.session', SESSION]]);
    device.files.set(IDS.encrypted, { key, data: partial, ops: [] });

    const store = launch(device).open();
    expect(store.file.data.get('clickco.booking-draft')).toBe(DRAFT);
    expect(device.files.get(IDS.plain)?.data.size).toBe(0);
  });

  it('starts clean when the key is gone but an encrypted file came back from a backup', () => {
    const device = newDevice();
    const lostKey = newEncryptionKey((length) => new Uint8Array(length).fill(1));
    const data = new Map([['clickco.session', 'ciphertext']]);
    device.files.set(IDS.encrypted, { key: lostKey, data, ops: [] });

    const app = launch(device);
    const store = app.open();
    expect(app.calls).toEqual([
      'readKey',
      `destroy ${IDS.encrypted}`,
      'writeKey',
      `open ${IDS.encrypted}`,
    ]);
    expect(device.keychain).not.toBe(lostKey);
    expect(store.file.data.size).toBe(0);
  });

  it('treats a stored value that is not a key it wrote as no key', () => {
    const device = newDevice();
    device.keychain = 'too-short';
    launch(device).open();
    expect(device.keychain).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });
});

describe('openKv when the Keychain/Keystore fails', () => {
  it('does not open anything when the key cannot be read (device locked)', () => {
    const device = withPlainStore({ 'clickco.session': SESSION });
    device.keychain = newEncryptionKey((length) => new Uint8Array(length).fill(3));
    const app = launch(device, { readKeyError: new Error('errSecInteractionNotAllowed') });

    expect(() => app.open()).toThrow(KvKeyUnavailableError);
    expect(() => app.open()).toThrow(/read the storage key.*errSecInteractionNotAllowed/);
    expect(app.calls.every((call) => call === 'readKey')).toBe(true);
    expect(device.files.has(IDS.encrypted)).toBe(false);
    expect(device.files.get(IDS.plain)?.data.get('clickco.session')).toBe(SESSION);
  });

  it('does not open the store when a new key cannot be saved', () => {
    const device = newDevice();
    const app = launch(device, { writeKeyError: new Error('Keystore unavailable') });
    expect(() => app.open()).toThrow(/save the storage key.*Keystore unavailable/);
    expect(app.calls).not.toContain(`open ${IDS.encrypted}`);
    expect(app.calls).not.toContain(`open ${IDS.plain}`);
  });

  it('refuses a store that MMKV opened without encryption', () => {
    const app = launch(newDevice(), { opensUnencrypted: true });
    expect(() => app.open()).toThrow(/without encryption/);
  });
});

describe('newEncryptionKey', () => {
  it('maps 32 random bytes onto 32 URL-safe characters, one byte each', () => {
    const bytes = Uint8Array.from({ length: KEY_LENGTH }, (_, i) => [0, 63, 64, 255][i % 4] ?? 0);
    const key = newEncryptionKey(() => bytes);
    expect(key).toHaveLength(KEY_LENGTH);
    expect(key.slice(0, 4)).toBe('A_A_');
    expect(new TextEncoder().encode(key)).toHaveLength(KEY_LENGTH);
  });

  it('uses every one of the 64 symbols equally across all byte values', () => {
    const counts = new Map<string, number>();
    for (let start = 0; start < 256; start += KEY_LENGTH) {
      const key = newEncryptionKey((length) => Uint8Array.from({ length }, (_, i) => start + i));
      for (const char of key) counts.set(char, (counts.get(char) ?? 0) + 1);
    }
    expect(counts.size).toBe(64);
    expect(new Set(counts.values())).toEqual(new Set([4]));
  });

  it('rejects a random source that returns the wrong length', () => {
    expect(() => newEncryptionKey(() => new Uint8Array(16))).toThrow(/wrong length/);
  });
});
