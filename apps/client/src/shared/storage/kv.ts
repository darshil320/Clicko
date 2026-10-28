import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { createMMKV, deleteMMKV, existsMMKV, type MMKV } from 'react-native-mmkv';
import type { StateStorage } from 'zustand/middleware';
import { openKv } from './open-kv';
import { secureRandomBytes } from './secure-random';

/** The Keychain/Keystore entry that holds the store's encryption key. */
const KEY_NAME = 'clickco.client.kv-key';

/**
 * Readable only while the device is unlocked, and never restored onto another device (ADR-0025
 * D7). No biometric prompt: the key opens the store at every launch.
 */
const KEY_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  requireAuthentication: false,
};

/**
 * The app's one key-value store: MMKV, encrypted on iOS/Android with a key held in the
 * Keychain/Keystore (open-kv.ts). On web (development only) react-native-mmkv's localStorage-backed
 * store, unencrypted. Never AsyncStorage.
 *
 * Opened synchronously at import: zustand's persist hydrates from it as each store is created.
 *
 * If the key exists but cannot be read (iOS: the device is locked, as WHEN_UNLOCKED requires;
 * Android: a Keystore error), this throws KvKeyUnavailableError and the app does not start. That is
 * deliberate. Falling back to a plaintext store would write the session unencrypted. A fresh key
 * would orphan the real store. An in-memory store would show a signed-out app while the real
 * session sits on disk. The next launch with the device unlocked opens normally. The app runs no JS
 * in the background today, so any launch a person sees happens on an unlocked device.
 * (SecureStore returns null, not an error, when the key is missing or can never be decrypted;
 * open-kv.ts then starts a fresh store.)
 */
export const kv: MMKV = openKv(
  { plain: 'clickco.client', encrypted: 'clickco.client.secure' },
  {
    os: Platform.OS,
    readKey: () => SecureStore.getItem(KEY_NAME, KEY_OPTIONS),
    writeKey: (key) => SecureStore.setItem(KEY_NAME, key, KEY_OPTIONS),
    randomBytes: (length) => secureRandomBytes(length),
    open: (config) => createMMKV({ ...config }),
    exists: existsMMKV,
    destroy: deleteMMKV,
  },
);

/** Adapter for zustand's persist middleware (MMKV is synchronous, so stores hydrate on create). */
export const kvStorage: StateStorage = {
  getItem: (key) => kv.getString(key) ?? null,
  setItem: (key, value) => kv.set(key, value),
  removeItem: (key) => {
    kv.remove(key);
  },
};

/**
 * Run after a session ends. MMKV appends every write, so superseded values stay in the file until
 * it is rewritten. trim() rewrites a file that has grown past its first page and shrinks it. Below
 * that it does nothing, and it never zeroes freed bytes. Anything left is ciphertext under the
 * device-bound key, and sign-out also revokes the refresh token on the server.
 */
export function compactKv(): void {
  kv.trim();
}
