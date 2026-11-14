import { PhoneE164, SIGN_IN_NOTICE_VERSION, type SignInConsent } from '@clickco/contracts';
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
  agree: z
    .boolean()
    .refine(
      (value) => value,
      'Confirm you are 18 or older and agree to the Privacy Policy to continue',
    ),
});
export type PhoneForm = z.infer<typeof PhoneForm>;

/**
 * Sent with the code (DPDP s.6(10): we must be able to show the notice was accepted). The
 * phone step cannot send a code unless `agree` is ticked, so every verify carries it.
 */
export const SIGN_IN_CONSENT: SignInConsent = {
  adultConfirmed: true,
  noticeVersion: SIGN_IN_NOTICE_VERSION,
};

// The code field and resend countdown are shared with account deletion.
export { formatCountdown, OtpForm, secondsUntil } from '@/shared/otp';
