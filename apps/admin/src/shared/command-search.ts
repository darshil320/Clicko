import type { AdminBookingRow } from '@clickco/contracts';
import { formatCode, formatDate, formatTime } from './format';

/**
 * The ⌘K booking search rules (ADR-0026 D8), pure so they are unit-tested. The board's search
 * (`GET /admin/bookings?q=`) takes a reference, a phone or a client name, 2–80 characters.
 */
export const BOOKING_SEARCH = { minLength: 2, maxLength: 80, results: 5, debounceMs: 250 } as const;

/** The text to send, or null when it is too short to search. */
export function bookingSearchText(query: string): string | null {
  const text = query.trim().slice(0, BOOKING_SEARCH.maxLength);
  return text.length >= BOOKING_SEARCH.minLength ? text : null;
}

/** "CLK-4821 · Rahul Mehta" */
export const bookingLabel = (b: Pick<AdminBookingRow, 'reference' | 'clientName'>): string =>
  `${b.reference} · ${b.clientName}`;

/** "Surat · 14 Nov, 4:30 pm · Dispatching" */
export const bookingDescription = (
  b: Pick<AdminBookingRow, 'cityName' | 'scheduledStart' | 'status'>,
): string =>
  `${b.cityName} · ${formatDate(b.scheduledStart)}, ${formatTime(b.scheduledStart)} · ${formatCode(b.status)}`;
