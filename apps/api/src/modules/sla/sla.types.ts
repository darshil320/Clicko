import type { SlaKind } from '@clickco/contracts';
import type postgres from 'postgres';

export type Db = postgres.ISql;
export type Tx = postgres.TransactionSql;

export type SlaClockState = 'ARMED' | 'MET' | 'BREACHED' | 'CANCELLED';

export interface SlaClockRecord {
  readonly id: string;
  readonly bookingId: string;
  readonly kind: SlaKind;
  readonly state: SlaClockState;
  readonly anchorAt: Date;
  readonly dueAt: Date;
  readonly pausedAt: Date | null;
  readonly pausedMs: number;
  readonly metAt: Date | null;
  readonly breachedAt: Date | null;
}

/** A delayed `sla.clock-due` job to enqueue once the arming transaction has committed. */
export interface SlaTimer {
  readonly clockId: string;
  readonly at: Date;
}
