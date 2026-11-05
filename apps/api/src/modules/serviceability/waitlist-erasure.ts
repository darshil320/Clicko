import { Injectable } from '@nestjs/common';
import type postgres from 'postgres';

/**
 * Account deletion (ADR-0030): waitlist sign-ups made with the deleted account's number go, in
 * the deletion's transaction. The waitlist is keyed by phone, not by account.
 */
@Injectable()
export class WaitlistErasure {
  /** Returns how many entries were removed. */
  async eraseForPhone(tx: postgres.TransactionSql, phone: string): Promise<number> {
    const rows = await tx`DELETE FROM waitlist_entries WHERE phone_e164 = ${phone}`;
    return rows.count;
  }
}
