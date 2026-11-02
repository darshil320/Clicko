import type { DeliveryLinkKind } from '@clickco/contracts';

/** ADR-0016 delivery numbers in one place. */
export const DELIVERY_CONFIG = {
  /** Clickco's own link path: the provider link is resolved server-side and never shown. */
  publicPathPrefix: '/d/',
  /** A public link token: base64url(HMAC-SHA256), 43 characters (audit L2, link-tokens.ts). */
  publicToken: /^[A-Za-z0-9_-]{43}$/,
  /** Per-IP limit on the public link route. */
  linkHitsPerMinutePerIp: 60,
} as const;

/** Asset kind → StoragePort folder kind. */
export const STORAGE_KIND_OF: Readonly<Record<DeliveryLinkKind, 'RAW' | 'JPEG' | 'VIDEO'>> = {
  RAW_PHOTO: 'RAW',
  JPEG_PHOTO: 'JPEG',
  VIDEO: 'VIDEO',
};
