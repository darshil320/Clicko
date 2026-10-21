import { z } from 'zod';

// Mirrors of the Postgres enums in docs/clickco-04-schema.sql §1. Order matters:
// contracts.test.ts fails if these drift from the SQL.

export const PlanTier = z.enum(['BASIC', 'SEMI_PRO', 'PROFESSIONAL', 'EXPERT', 'SIGNATURE']);
export type PlanTier = z.infer<typeof PlanTier>;

export const CityTier = z.enum(['METRO', 'TIER_1', 'TIER_2', 'TIER_3']);
export type CityTier = z.infer<typeof CityTier>;

export const AreaStatus = z.enum(['LIVE', 'PILOT', 'WAITLIST', 'BLOCKED']);
export type AreaStatus = z.infer<typeof AreaStatus>;

export const BookingStatus = z.enum([
  'DRAFT',
  'QUOTED',
  'ADVANCE_PENDING',
  'CONFIRMED',
  'DISPATCHING',
  'ASSIGNED',
  'EN_ROUTE',
  'CHECKED_IN',
  'IN_PROGRESS',
  'CHECKED_OUT',
  'UPLOADING',
  'PROCESSING',
  'QA',
  'BALANCE_PENDING',
  'DELIVERED',
  'CLOSED',
  'CANCELLED_CLIENT',
  'CANCELLED_PRO',
  'PRO_NO_SHOW',
  'ACCESS_DENIED',
  'UNSAFE_SITE',
  'DATA_LOSS',
  'QUALITY_ESCALATION',
  'ABANDONED',
]);
export type BookingStatus = z.infer<typeof BookingStatus>;

/** Computed from lead time at quote time, never user-selected (DOMAIN Invariant 19). */
export const EmergencyBand = z.enum(['NONE', 'NEXT_DAY', 'SAME_DAY', 'HOURS_3_8', 'HOURS_UNDER_3']);
export type EmergencyBand = z.infer<typeof EmergencyBand>;

export const PhotographerStatus = z.enum([
  'APPLICANT',
  'ACTIVE',
  'PAUSED',
  'SUSPENDED',
  'OFFBOARDED',
]);
export type PhotographerStatus = z.infer<typeof PhotographerStatus>;

export const SlaKind = z.enum([
  'UPLOAD_START',
  'UPLOAD_COMPLETE',
  'PROCESSING_COMPLETE',
  'QA_COMPLETE',
  'DELIVERY_DUE',
  'DELIVERY_RED_ALERT',
  'BALANCE_REMINDER',
  'BOOKING_ABANDON',
  'RAW_PURGE',
  'JPEG_PURGE',
  'LINK_REVOKE',
]);
export type SlaKind = z.infer<typeof SlaKind>;

export const StaffRole = z.enum([
  'SUPER_ADMIN',
  'FINANCE',
  'CITY_MANAGER',
  'OPS_AGENT',
  'QUALITY_MANAGER',
  'SUPPORT',
  'READ_ONLY',
]);
export type StaffRole = z.infer<typeof StaffRole>;
