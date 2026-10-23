import { z } from 'zod';
import { IsoDateTime, PhoneE164, Uuid } from './common.js';

/** LOGIN = client app; PRO_LOGIN = photographer app (ADR-0010), issued only via /pro/auth. */
export const OtpPurpose = z.enum(['LOGIN', 'PRO_LOGIN']);
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

export const VerifyOtpBody = z.object({
  challengeId: Uuid,
  phone: PhoneE164,
  code: OtpCode,
  deviceId: z.string().min(1).max(128).optional(),
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
