import { useCallback } from 'react';
import type { BookableTier } from '@/shared/catalogue';
import { newDraft } from './lib/draft';
import { earliestSlot, referenceSlot } from './lib/schedule';
import { useBookingDraft } from './store';

export interface StartBooking {
  readonly tier: BookableTier;
  readonly pincode: string;
  readonly categoryCode?: string;
  /** "earliest" for the emergency banner; otherwise the standard reference slot. */
  readonly when?: 'earliest' | 'reference';
}

/** Begins a fresh draft (discarding any previous checkout state). */
export function useStartBooking(): (input: StartBooking) => void {
  const start = useBookingDraft((s) => s.start);
  return useCallback(
    ({ tier, pincode, categoryCode, when = 'reference' }: StartBooking) => {
      const now = new Date();
      const slot = when === 'earliest' ? earliestSlot(now) : referenceSlot(now);
      start(newDraft({ tier, pincode, slot, ...(categoryCode ? { categoryCode } : {}) }));
    },
    [start],
  );
}
