import { createMMKV } from 'react-native-mmkv';
import type { StateStorage } from 'zustand/middleware';

/**
 * The app's one key-value store. MMKV on iOS/Android; on web react-native-mmkv ships a
 * localStorage-backed implementation (platform file createMMKV.web), so the same code runs.
 * Never AsyncStorage.
 */
export const kv = createMMKV({ id: 'clickco.client' });

/** Adapter for zustand's persist middleware (MMKV is synchronous, so stores hydrate on create). */
export const kvStorage: StateStorage = {
  getItem: (key) => kv.getString(key) ?? null,
  setItem: (key, value) => kv.set(key, value),
  removeItem: (key) => {
    kv.remove(key);
  },
};
