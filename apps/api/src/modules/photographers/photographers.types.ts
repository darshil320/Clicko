import type { PlanTier } from '@clickco/contracts';
import type postgres from 'postgres';

/** A plain connection or an open transaction. */
export type Db = postgres.ISql;

export interface PhotographerIdentity {
  readonly id: string;
  readonly fullName: string;
  readonly cityId: string;
}

/** photographer_metrics — rolling aggregates; null when the nightly job has not computed one yet. */
export interface PhotographerMetrics {
  readonly ratingAvgBps: number | null;
  readonly ratingCount: number;
  readonly acceptanceRateBps: number | null;
  readonly onTimeUploadRateBps: number | null;
  readonly noShowCount: number;
}

/** Everything about one booking that the hard filters (ADR-0010) depend on. */
export interface PoolCriteria {
  readonly cityId: string;
  readonly tier: PlanTier;
  readonly categoryId: string;
  /** categories.cert_required_from — certification needed at this tier or above (null = never). */
  readonly certRequiredFrom: PlanTier | null;
  readonly shootStart: Date;
  readonly shootEnd: Date;
  /** The shoot ± the travel buffer: personal blocks must not overlap it. */
  readonly blockedFrom: Date;
  readonly blockedUntil: Date;
  /** Emergency bands only reach photographers with accepts_emergency. */
  readonly emergencyOnly: boolean;
  /** A DRONE add-on needs approved, unexpired DRONE_RPC and DRONE_UIN documents. */
  readonly needsDroneCredentials: boolean;
}

/**
 * A photographer who passes every non-geographic hard filter. `baseLocation` is the geography
 * value exactly as Postgres returns it (hex EWKB) — opaque here; only dispatch/repositories
 * interprets it with PostGIS.
 */
export interface PoolMember {
  readonly id: string;
  readonly fullName: string;
  readonly serviceRadiusKm: number;
  readonly baseLocation: string;
  readonly metrics: PhotographerMetrics | null;
}

/** photographer_penalties.kind values Sprint 5 writes (ADR-0012 D7). */
export type PenaltyKind = 'NO_SHOW' | 'CONDUCT';

export interface NewPenalty {
  readonly photographerId: string;
  readonly bookingId: string;
  readonly kind: PenaltyKind;
  readonly note: string;
  readonly at: Date;
}

/** Re-checked inside the accept transaction (ADR-0012). */
export type AcceptAvailability = 'OK' | 'INACTIVE' | 'BLOCKED';
