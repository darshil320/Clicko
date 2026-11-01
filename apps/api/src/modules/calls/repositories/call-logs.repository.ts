import { Injectable } from '@nestjs/common';
import type postgres from 'postgres';
import type { CallStatus } from '../calls.port';

type Db = postgres.ISql;

export type CallerKind = 'USER' | 'PHOTOGRAPHER';

export interface CallLogEntry {
  readonly callId: string;
  readonly bindingId: string;
  readonly bookingId: string;
  readonly callerKind: CallerKind;
  readonly provider: string;
  readonly providerCallId: string | null;
  readonly status: CallStatus;
  readonly durationSeconds: number | null;
  readonly errorCode: string | null;
  readonly at: Date;
}

/** The call a status callback is about: its INITIATED row (the one with the provider's id). */
export interface PlacedCall {
  readonly callId: string;
  readonly bindingId: string;
  readonly bookingId: string;
  readonly callerKind: CallerKind;
  /** A final status is already on record (a redelivered callback). */
  readonly settled: boolean;
}

/**
 * call_logs: append-only (INSERT and SELECT only, migration 0015). Every row of one call shares
 * its call_id: REQUESTED (the reservation), INITIATED with the provider's id (or FAILED), then the
 * provider's final status and duration.
 */
@Injectable()
export class CallLogsRepository {
  async insert(db: Db, e: CallLogEntry): Promise<void> {
    await db`
      INSERT INTO call_logs
        (call_id, binding_id, booking_id, caller_kind, provider, provider_call_id, status,
         duration_seconds, error_code, created_at)
      VALUES (${e.callId}, ${e.bindingId}, ${e.bookingId}, ${e.callerKind}, ${e.provider},
              ${e.providerCallId}, ${e.status}, ${e.durationSeconds}, ${e.errorCode}, ${e.at})`;
  }

  /**
   * Serialises one side's call requests on one binding until the transaction ends: the count and
   * the REQUESTED reservation happen under it, so parallel requests cannot all pass the limit.
   */
  async lockCaller(tx: Db, bindingId: string, callerKind: CallerKind): Promise<void> {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${`call-cap:${bindingId}:${callerKind}`}))`;
  }

  /** Calls this side asked for on this binding since each instant (the per-caller rate limits). */
  async placedSince(
    db: Db,
    bindingId: string,
    callerKind: CallerKind,
    recentSince: Date,
    daySince: Date,
  ): Promise<{ readonly recent: number; readonly day: number }> {
    const [row] = await db<{ recent: number; day: number }[]>`
      SELECT count(DISTINCT call_id) FILTER (WHERE created_at >= ${recentSince})::int AS recent,
             count(DISTINCT call_id)::int AS day
      FROM call_logs
      WHERE binding_id = ${bindingId} AND caller_kind = ${callerKind} AND created_at >= ${daySince}`;
    return { recent: row?.recent ?? 0, day: row?.day ?? 0 };
  }

  /** Locks out concurrent callbacks for the same provider call until the transaction ends. */
  async lockProviderCall(tx: Db, provider: string, providerCallId: string): Promise<void> {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${`call:${provider}:${providerCallId}`}))`;
  }

  async findPlaced(db: Db, provider: string, providerCallId: string): Promise<PlacedCall | null> {
    const [row] = await db<
      {
        call_id: string;
        binding_id: string;
        booking_id: string;
        caller_kind: CallerKind;
        settled: boolean;
      }[]
    >`
      SELECT p.call_id, p.binding_id, p.booking_id, p.caller_kind,
             EXISTS (SELECT 1 FROM call_logs s
                      WHERE s.call_id = p.call_id
                        AND s.status NOT IN ('REQUESTED', 'INITIATED')) AS settled
      FROM call_logs p
      WHERE p.provider = ${provider} AND p.provider_call_id = ${providerCallId}
        AND p.status = 'INITIATED'
      ORDER BY p.id LIMIT 1`;
    return row
      ? {
          callId: row.call_id,
          bindingId: row.binding_id,
          bookingId: row.booking_id,
          callerKind: row.caller_kind,
          settled: row.settled,
        }
      : null;
  }
}
