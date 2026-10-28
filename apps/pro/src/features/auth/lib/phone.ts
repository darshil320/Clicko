import { OtpCode, PhoneE164 } from '@clickco/contracts';
import { z } from 'zod';

/**
 * Accepts the ways people type an Indian mobile — "98000 00777", "098000-00777",
 * "+91 98000 00777", "919800000777" — and returns E.164 (+91XXXXXXXXXX), or null.
 */
export function toE164(input: string): string | null {
  const digits = input.replace(/[^\d]/g, '');
  const national =
    digits.length === 10
      ? digits
      : digits.length === 11 && digits.startsWith('0')
        ? digits.slice(1)
        : digits.length === 12 && digits.startsWith('91')
          ? digits.slice(2)
          : null;
  if (national === null) return null;
  const e164 = `+91${national}`;
  return PhoneE164.safeParse(e164).success ? e164 : null;
}

export const PhoneForm = z.object({
  phone: z.string().refine((value) => toE164(value) !== null, 'Enter your 10-digit mobile number'),
});
export type PhoneForm = z.infer<typeof PhoneForm>;

export const OtpForm = z.object({
  code: z
    .string()
    .trim()
    .refine((value) => OtpCode.safeParse(value).success, 'Enter the 6-digit code'),
});
export type OtpForm = z.infer<typeof OtpForm>;

/** Seconds left before "Resend code" unlocks, never negative. */
export function secondsUntil(unlockAtMs: number, nowMs: number): number {
  return Math.max(0, Math.ceil((unlockAtMs - nowMs) / 1000));
}

/** 27 → "0:27" */
export function formatCountdown(seconds: number): string {
  return `${Math.trunc(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
