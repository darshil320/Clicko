import { Inject, Injectable } from '@nestjs/common';
import type postgres from 'postgres';
import { SQL } from '../../../infra/db/db.module';
import type {
  PayeeDirectoryPort,
  PayeeFacts,
  PenaltyDeductionsPort,
  PenaltyFact,
  SealedAccountNumber,
} from '../ports';

interface PayeeRow {
  id: string;
  full_name: string;
  city_id: string;
  pan_number: string | null;
  pan_verified_at: Date | null;
  is_gst_registered: boolean;
  account_id: string | null;
  account_holder: string | null;
  bank_name: string | null;
  ifsc: string | null;
  account_last4: string | null;
  account_verified_at: Date | null;
}

const toPayee = (r: PayeeRow): PayeeFacts => ({
  photographerId: r.id,
  name: r.full_name,
  cityId: r.city_id,
  pan: r.pan_number,
  panVerified: r.pan_verified_at !== null,
  gstRegistered: r.is_gst_registered,
  bank:
    r.account_id && r.account_holder && r.ifsc && r.account_last4
      ? {
          accountId: r.account_id,
          holder: r.account_holder,
          bankName: r.bank_name,
          ifsc: r.ifsc,
          last4: r.account_last4.trim(),
          verified: r.account_verified_at !== null,
        }
      : null,
});

/**
 * INTERIM (stream B, ADR-0026 D3): read-only SQL on the photographer tables, because
 * PhotographersService has no payee read yet and modules/photographers belongs to stream C this
 * sprint. Replace with `PhotographersService.payees / sealedAccountNumbers / unwaivedPenalties`
 * when it lands; the ports in ../ports.ts stay as they are. Nothing here writes.
 */
@Injectable()
export class PhotographerReadsAdapter implements PayeeDirectoryPort, PenaltyDeductionsPort {
  constructor(@Inject(SQL) private readonly sql: postgres.Sql) {}

  async payees(photographerIds: readonly string[]): Promise<Map<string, PayeeFacts>> {
    if (photographerIds.length === 0) return new Map();
    const rows = await this.sql<PayeeRow[]>`
      SELECT p.id, p.full_name, p.city_id, p.pan_number, p.pan_verified_at, p.is_gst_registered,
             b.id AS account_id, b.account_holder, b.bank_name, b.ifsc, b.account_last4,
             b.verified_at AS account_verified_at
      FROM photographers p
      LEFT JOIN photographer_bank_accounts b ON b.photographer_id = p.id AND b.is_primary
      WHERE p.id IN ${this.sql([...new Set(photographerIds)])}`;
    return new Map(rows.map((r) => [r.id, toPayee(r)]));
  }

  async sealedAccountNumbers(
    accountIds: readonly string[],
  ): Promise<Map<string, SealedAccountNumber>> {
    if (accountIds.length === 0) return new Map();
    const rows = await this.sql<{ id: string; photographer_id: string; sealed: Buffer }[]>`
      SELECT id, photographer_id, account_number_enc AS sealed
      FROM photographer_bank_accounts WHERE id IN ${this.sql([...new Set(accountIds)])}`;
    return new Map(
      rows.map((r) => [
        r.id,
        { accountId: r.id, photographerId: r.photographer_id, sealed: Buffer.from(r.sealed) },
      ]),
    );
  }

  async unwaived(photographerIds: readonly string[]): Promise<PenaltyFact[]> {
    if (photographerIds.length === 0) return [];
    const rows = await this.sql<
      {
        id: string;
        photographer_id: string;
        booking_id: string;
        kind: string;
        payout_deduction_bps: number;
      }[]
    >`
      SELECT id, photographer_id, booking_id, kind, payout_deduction_bps
      FROM photographer_penalties
      WHERE photographer_id IN ${this.sql([...new Set(photographerIds)])}
        AND NOT waived AND payout_deduction_bps > 0 AND booking_id IS NOT NULL
      ORDER BY created_at, id`;
    return rows.map((r) => ({
      penaltyId: r.id,
      photographerId: r.photographer_id,
      bookingId: r.booking_id,
      kind: r.kind,
      payoutDeductionBps: r.payout_deduction_bps,
    }));
  }
}
