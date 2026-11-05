import { OtpCode } from '@clickco/contracts';
import { z } from 'zod';

/**
 * The 6-digit SMS code pattern, shared by sign-in (features/auth) and account deletion
 * (features/account): the same field rule and the same "Resend code in 0:27" countdown.
 */
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
