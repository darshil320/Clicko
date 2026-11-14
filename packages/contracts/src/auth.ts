import { z } from 'zod';
import { IsoDateTime, PhoneE164, Uuid } from './common.js';

/**
 * LOGIN = client app; PRO_LOGIN = photographer app (ADR-0010), issued only via /pro/auth;
 * ACCOUNT_DELETE = a signed-in client re-confirming deletion (ADR-0030), only via /me/deletion.
 */
export const OtpPurpose = z.enum(['LOGIN', 'PRO_LOGIN', 'ACCOUNT_DELETE']);
export type OtpPurpose = z.infer<typeof OtpPurpose>;

export const OtpCode = z.string().regex(/^\d{6}$/, 'must be 6 digits');

/** POST /auth/otp/request — client logins only; photographers use /pro/auth/otp/request. */
export const RequestOtpBody = z.object({
  phone: PhoneE164,
  purpose: z.literal('LOGIN').default('LOGIN'),
});
export type RequestOtpBody = z.infer<typeof RequestOtpBody>;

export const RequestOtpResponse = z.object({
  challengeId: Uuid,
  expiresAt: IsoDateTime,
  resendAfterSeconds: z.int().min(0),
});
export type RequestOtpResponse = z.infer<typeof RequestOtpResponse>;

/** Privacy-notice version shown at sign-in: the date the notice took effect. */
export const SIGN_IN_NOTICE_VERSION = '2026-11-14';

/**
 * The sign-in checkbox "I am 18 or older and agree to the Privacy Policy and Terms" (DPDP Act
 * 2023 s.6, s.9). Required when the sign-in creates the account (CONSENT_REQUIRED otherwise);
 * recorded in the consent log whenever sent.
 */
export const SignInConsent = z.object({
  adultConfirmed: z.literal(true),
  noticeVersion: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type SignInConsent = z.infer<typeof SignInConsent>;

export const VerifyOtpBody = z.object({
  challengeId: Uuid,
  phone: PhoneE164,
  code: OtpCode,
  deviceId: z.string().min(1).max(128).optional(),
  consent: SignInConsent.optional(),
});
export type VerifyOtpBody = z.infer<typeof VerifyOtpBody>;

export const SessionUser = z.object({
  id: Uuid,
  phone: PhoneE164,
  fullName: z.string().nullable(),
  isNew: z.boolean(),
});
export type SessionUser = z.infer<typeof SessionUser>;

export const TokenPair = z.object({
  accessToken: z.string().min(1),
  accessTokenExpiresAt: IsoDateTime,
  refreshToken: z.string().min(1),
  refreshTokenExpiresAt: IsoDateTime,
});
export type TokenPair = z.infer<typeof TokenPair>;

export const VerifyOtpResponse = TokenPair.extend({ user: SessionUser });
export type VerifyOtpResponse = z.infer<typeof VerifyOtpResponse>;

export const RefreshBody = z.object({ refreshToken: z.string().min(32).max(256) });
export type RefreshBody = z.infer<typeof RefreshBody>;
