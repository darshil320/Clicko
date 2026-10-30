import { INDIA_TIME_ZONE } from './format';

/**
 * Today's header (ADR-0026 D8): "Good afternoon, Aisha" by the IST hour, whatever the
 * browser's zone. Pure, so it is unit-tested.
 */

const HOUR = new Intl.DateTimeFormat('en-GB', {
  timeZone: INDIA_TIME_ZONE,
  hour: '2-digit',
  hourCycle: 'h23',
});

/** 0–23, the hour in IST. */
export function istHour(at: number): number {
  return Number.parseInt(HOUR.format(new Date(at)), 10);
}

/** Morning from 4 am, afternoon from noon, evening from 5 pm (IST). */
export function greetingFor(at: number): string {
  const hour = istHour(at);
  if (hour >= 4 && hour < 12) return 'Good morning';
  if (hour >= 12 && hour < 17) return 'Good afternoon';
  return 'Good evening';
}

/** "Aisha Khan" → "Aisha"; a blank name greets nobody in particular. */
export function firstName(fullName: string): string | null {
  return fullName.trim().split(/\s+/)[0] || null;
}

/** "Good afternoon, Aisha" */
export function greeting(at: number, fullName: string): string {
  const name = firstName(fullName);
  return name ? `${greetingFor(at)}, ${name}` : greetingFor(at);
}
