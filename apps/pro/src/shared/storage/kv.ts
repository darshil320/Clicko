import { createMMKV } from 'react-native-mmkv';
import type { StateStorage } from 'zustand/middleware';

/**
 * The Pro app's one key-value store: the session and the offline queue (ADR-0024 D6).
 * MMKV on iOS/Android; on web react-native-mmkv ships a localStorage-backed implementation.
 * Never AsyncStorage.
 */
export const kv = createMMKV({ id: 'clickco.pro' });

/** Adapter for zustand's persist middleware (MMKV is synchronous, so stores hydrate on create). */
export const kvStorage: StateStorage = {
  getItem: (key) => kv.getString(key) ?? null,
  setItem: (key, value) => kv.set(key, value),
  removeItem: (key) => {
    kv.remove(key);
  },
};
