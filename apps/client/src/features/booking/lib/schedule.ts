import {
  addDays,
  formatDayMonth,
  formatWeekday,
  istDateKey,
  istParts,
  weekdayOf,
} from '@/shared/format/datetime';

/** 30-minute start times from 6:00 am to 10:00 pm IST (night rates from 10 pm are priced by the API). */
export const SLOT_STEP_MINUTES = 30;
export const FIRST_SLOT_MINUTE = 6 * 60;
export const LAST_SLOT_MINUTE = 22 * 60;
/** A same-day slot must start at least this far ahead — time to dispatch a photographer. */
export const MIN_LEAD_MINUTES = 60;
export const BOOKING_WINDOW_DAYS = 14;
/** "From" prices: a weekday at least this many days out sits in the standard (non-emergency) band. */
const REFERENCE_LEAD_DAYS = 3;
const REFERENCE_MINUTE = 11 * 60;

export interface Slot {
  readonly dateKey: string;
  readonly startMinute: number;
}

export interface DatePill {
  readonly dateKey: string;
  readonly weekday: string;
  readonly label: string;
  readonly isToday: boolean;
}

const ceilToStep = (minute: number): number =>
  Math.ceil(minute / SLOT_STEP_MINUTES) * SLOT_STEP_MINUTES;

/** Start times still bookable on `dateKey`, given the current instant. */
export function timeSlots(dateKey: string, now: Date): readonly number[] {
  const today = istDateKey(now);
  if (dateKey < today) return [];
  const earliest =
    dateKey === today
      ? Math.max(FIRST_SLOT_MINUTE, ceilToStep(istParts(now).minuteOfDay + MIN_LEAD_MINUTES))
      : FIRST_SLOT_MINUTE;
  const slots: number[] = [];
  for (let m = earliest; m <= LAST_SLOT_MINUTE; m += SLOT_STEP_MINUTES) slots.push(m);
  return slots;
}

/** The next 14 bookable days in IST, starting today if any slot is left today. */
export function datePills(now: Date, days: number = BOOKING_WINDOW_DAYS): readonly DatePill[] {
  const today = istDateKey(now);
  const first = timeSlots(today, now).length > 0 ? today : addDays(today, 1);
  return Array.from({ length: days }, (_, i) => {
    const dateKey = addDays(first, i);
    return {
      dateKey,
      weekday: dateKey === today ? 'Today' : formatWeekday(dateKey),
      label: formatDayMonth(dateKey),
      isToday: dateKey === today,
    };
  });
}

/** The soonest bookable slot — the emergency banner's "Book in the next 3 hours". */
export function earliestSlot(now: Date): Slot {
  const first = datePills(now, 1)[0];
  if (!first) throw new Error('no bookable day');
  const startMinute = timeSlots(first.dateKey, now)[0] ?? FIRST_SLOT_MINUTE;
  return { dateKey: first.dateKey, startMinute };
}

/** A weekday ≥3 days out at 11:00 am: no emergency, night or weekend factor in the price. */
export function referenceSlot(now: Date): Slot {
  let dateKey = addDays(istDateKey(now), REFERENCE_LEAD_DAYS);
  while (weekdayOf(dateKey) === 0 || weekdayOf(dateKey) === 6) dateKey = addDays(dateKey, 1);
  return { dateKey, startMinute: REFERENCE_MINUTE };
}

/** Keeps a chosen slot valid as time passes: an expired one moves to the next open start. */
export function clampSlot(slot: Slot, now: Date): Slot {
  const pills = datePills(now);
  const day = pills.some((p) => p.dateKey === slot.dateKey) ? slot.dateKey : pills[0]?.dateKey;
  if (!day) return slot;
  const slots = timeSlots(day, now);
  if (slots.includes(slot.startMinute)) return { dateKey: day, startMinute: slot.startMinute };
  const later = slots.find((m) => m >= slot.startMinute);
  return { dateKey: day, startMinute: later ?? slots[0] ?? FIRST_SLOT_MINUTE };
}
