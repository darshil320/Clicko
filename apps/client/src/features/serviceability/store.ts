import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { kvStorage } from '@/shared/storage/kv';

/** The client's chosen shoot location. Only a bookable pincode is ever saved here. */
interface LocationState {
  readonly pincode: string | null;
  readonly label: string | null;
  readonly cityName: string | null;
  setLocation(location: { pincode: string; label: string; cityName: string }): void;
  clear(): void;
}

export const useLocation = create<LocationState>()(
  persist(
    (set) => ({
      pincode: null,
      label: null,
      cityName: null,
      setLocation: ({ pincode, label, cityName }) => set({ pincode, label, cityName }),
      clear: () => set({ pincode: null, label: null, cityName: null }),
    }),
    {
      name: 'clickco.location',
      version: 1,
      storage: createJSONStorage(() => kvStorage),
      partialize: ({ pincode, label, cityName }) => ({ pincode, label, cityName }),
    },
  ),
);
