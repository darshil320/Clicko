import { Injectable } from '@nestjs/common';
import type postgres from 'postgres';

export interface AuthErasure {
  readonly otpChallenges: number;
  readonly sessions: number;
}

/**
 * Account deletion (ADR-0030), in the deletion's transaction: the sign-in codes sent to the
 * number go (they hold the phone and the requesting IP), and every client session is revoked with
 * its device id and user agent cleared. The revoked rows stay so a replayed token is still seen as
 * a replay.
 */
@Injectable()
export class AuthAccountErasure {
  async eraseClient(
    tx: postgres.TransactionSql,
    userId: string,
    phone: string,
    at: Date,
  ): Promise<AuthErasure> {
    const otp = await tx`DELETE FROM otp_challenges WHERE phone_e164 = ${phone}`;
    const sessions = await tx`
      UPDATE refresh_tokens
         SET revoked_at = coalesce(revoked_at, ${at}), device_id = NULL, user_agent = NULL
       WHERE subject_kind = 'USER' AND subject_id = ${userId}`;
    return { otpChallenges: otp.count, sessions: sessions.count };
  }
}
