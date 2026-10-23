import { Pincode, type ServiceabilityResult } from '@clickco/contracts';
import { z } from 'zod';

/** "395 007" → "395007"; anything that is not a valid Indian pincode → null. */
export function normalisePincode(input: string): string | null {
  const digits = input.replace(/\s+/g, '');
  return Pincode.safeParse(digits).success ? digits : null;
}

export const PincodeForm = z.object({
  pincode: z
    .string()
    .refine((value) => normalisePincode(value) !== null, 'Enter a 6-digit pincode'),
});
export type PincodeForm = z.infer<typeof PincodeForm>;

export const WaitlistForm = z.object({
  fullName: z.string().trim().min(1, 'Tell us your name').max(120, 'That name is too long'),
});
export type WaitlistForm = z.infer<typeof WaitlistForm>;

type Bookable = Extract<ServiceabilityResult, { bookable: true }>;
type NotBookable = Extract<ServiceabilityResult, { bookable: false }>;

/** "Vesu, Surat" when the area is known, else "Surat". */
export function locationLabel(result: Bookable): string {
  return result.areaName ? `${result.areaName}, ${result.city.name}` : result.city.name;
}

/** The headline for a pincode we cannot book yet. */
export function notServedHeadline(result: NotBookable): string {
  const place = result.cityName ?? `pincode ${result.pincode}`;
  switch (result.status) {
    case 'WAITLIST':
      return `We're coming to ${place} soon`;
    case 'BLOCKED':
      return `We can't take bookings in ${place} right now`;
    default:
      return `We don't shoot in ${place} yet`;
  }
}

/** "1 person is waiting" / "24 people are waiting" / null for nobody. */
export function waitingLine(waitingCount: number): string | null {
  if (waitingCount <= 0) return null;
  return waitingCount === 1
    ? '1 person is waiting here'
    : `${waitingCount} people are waiting here`;
}
