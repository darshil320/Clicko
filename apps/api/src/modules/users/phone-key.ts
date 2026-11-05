import { createHmac } from 'node:crypto';

/**
 * ADR-0030: a keyed hash of an account's phone, stored on its bookings so promo eligibility
 * (first booking, per-person cap) still counts them after the account is deleted and the number
 * signs up again. HMAC under OTP_HASH_PEPPER with its own label, so it can never be matched
 * against any other value derived from that secret. Never the number itself.
 */
export function promoPhoneKey(pepper: string, phone: string): string {
  return createHmac('sha256', pepper).update(`promo-phone:${phone}`).digest('hex');
}
