import { newIdempotencyKey } from '@clickco/api-client';
import type { AddonCode, PayBookingResponse } from '@clickco/contracts';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { BookableTier } from '@/shared/catalogue';
import { claimKey, type KeyRing } from '@/shared/idempotency';
import { kvStorage } from '@/shared/storage/kv';
import { type BookingDraft, setReels, toggleAddon, upgradeDraft, withTier } from './lib/draft';

export interface CreatedBooking {
  readonly bookingId: string;
  /** Fingerprint of the POST /bookings body that created it. */
  readonly fingerprint: string;
}

export interface OpenPayment {
  readonly bookingId: string;
  readonly payment: PayBookingResponse;
}

interface BookingDraftState {
  readonly draft: BookingDraft | null;
  readonly keys: KeyRing;
  readonly created: CreatedBooking | null;
  readonly payment: OpenPayment | null;
  start(draft: BookingDraft): void;
  update(patch: Partial<Omit<BookingDraft, 'tier' | 'addons' | 'reels'>>): void;
  setTier(tier: BookableTier): void;
  toggleAddon(code: AddonCode): void;
  setReels(count: number): void;
  /** The Idempotency-Key for `scope` + this exact request (reused on retry, fresh on change). */
  claimKey(scope: string, fingerprint: string): string;
  bookingCreated(created: CreatedBooking): void;
  /** Drops the created booking and its create-key (e.g. its quote expired): next try starts fresh. */
  forgetCreated(): void;
  paymentOpened(payment: OpenPayment): void;
  clear(): void;
}

const EMPTY = { draft: null, keys: {}, created: null, payment: null } as const;

type PersistedDraftState = Pick<BookingDraftState, 'draft' | 'keys' | 'created' | 'payment'>;

/** Upgrades a persisted state from an older version; never mutates what was read. */
function migrateDraftState(persisted: unknown, version: number): PersistedDraftState {
  const state = (persisted ?? EMPTY) as PersistedDraftState;
  return { ...state, draft: upgradeDraft(state.draft, version) };
}

/**
 * The booking being put together, plus the keys and ids of its checkout. Persisted, so a
 * web refresh or an app restart mid-checkout resumes instead of double-booking.
 */
export const useBookingDraft = create<BookingDraftState>()(
  persist(
    (set, get) => ({
      ...EMPTY,
      start: (draft) => set({ ...EMPTY, draft }),
      update: (patch) => {
        const { draft } = get();
        if (draft) set({ draft: { ...draft, ...patch } });
      },
      setTier: (tier) => {
        const { draft } = get();
        if (draft) set({ draft: withTier(draft, tier) });
      },
      toggleAddon: (code) => {
        const { draft } = get();
        if (draft) set({ draft: toggleAddon(draft, code) });
      },
      setReels: (count) => {
        const { draft } = get();
        if (draft) set({ draft: setReels(draft, count) });
      },
      claimKey: (scope, fingerprint) => {
        const claimed = claimKey(get().keys, scope, fingerprint, () => newIdempotencyKey());
        if (claimed.ring !== get().keys) set({ keys: claimed.ring });
        return claimed.key;
      },
      bookingCreated: (created) => set({ created }),
      forgetCreated: () =>
        set(({ keys }) => ({
          created: null,
          keys: Object.fromEntries(Object.entries(keys).filter(([scope]) => scope !== 'create')),
        })),
      paymentOpened: (payment) => set({ payment }),
      clear: () => set(EMPTY),
    }),
    {
      name: 'clickco.booking-draft',
      version: 2,
      // v2 (ADR-0034): drafts gained a reel count. A v1 draft resumes with none.
      migrate: (persisted, version) => migrateDraftState(persisted, version),
      storage: createJSONStorage(() => kvStorage),
      partialize: ({ draft, keys, created, payment }) => ({ draft, keys, created, payment }),
    },
  ),
);

/** The draft holds a venue address, a booking id and idempotency keys: it ends with the session. */
export const clearBookingDraft = (): void => useBookingDraft.getState().clear();
