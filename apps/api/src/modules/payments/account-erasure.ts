import { Injectable } from '@nestjs/common';
import type postgres from 'postgres';

/**
 * Account deletion (ADR-0030), in the deletion's transaction. Payments are kept (tax and refund
 * records), but a UPI id often is the client's phone number: only its handle stays
 * ("9876543210@ybl" → "•••@ybl"), and anything longer than a card's last four keeps four.
 * Refunds still go back to the original method through the gateway's own payment id.
 */
@Injectable()
export class PaymentAccountErasure {
  /** Returns how many payments were masked. */
  async maskClient(tx: postgres.TransactionSql, userId: string): Promise<number> {
    const rows = await tx`
      UPDATE payments
         SET vpa_or_last4 = CASE
               WHEN position('@' IN vpa_or_last4) > 0
                 THEN '•••' || substring(vpa_or_last4 FROM '@[^@]*$')
               ELSE right(vpa_or_last4, 4)
             END
       WHERE user_id = ${userId}
         AND vpa_or_last4 IS NOT NULL
         AND (position('@' IN vpa_or_last4) > 0 OR length(vpa_or_last4) > 4)
         AND vpa_or_last4 NOT LIKE '•••@%'`;
    return rows.count;
  }
}
