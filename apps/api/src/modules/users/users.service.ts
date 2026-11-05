import { Inject, Injectable } from '@nestjs/common';
import type postgres from 'postgres';
import { ENV, type Env } from '../../config/env';
import { promoPhoneKey } from './phone-key';
import {
  type PhoneUserRecord,
  type UserRecord,
  UsersRepository,
} from './repositories/users.repository';

/** The only way other modules read or create users (they never query the users table). */
@Injectable()
export class UsersService {
  private readonly pepper: string;

  constructor(
    @Inject(UsersRepository) private readonly repo: UsersRepository,
    @Inject(ENV) env: Env,
  ) {
    this.pepper = env.OTP_HASH_PEPPER;
  }

  /**
   * ADR-0030: the keyed hash of the account's phone that bookings carry for promo eligibility, so
   * a deleted account's bookings still count for the same number. null for a deleted account.
   */
  async promoKey(id: string): Promise<string | null> {
    const user = await this.repo.findById(id);
    return user?.phone ? promoPhoneKey(this.pepper, user.phone) : null;
  }

  findOrCreateByPhone(phone: string): Promise<{ user: PhoneUserRecord; isNew: boolean }> {
    return this.repo.findOrCreateByPhone(phone);
  }

  /** Deleted accounts too (deletedAt set, phone null): callers decide what that means. */
  findById(id: string): Promise<UserRecord | null> {
    return this.repo.findById(id);
  }

  /** The account row under FOR UPDATE, in the caller's transaction (account deletion). */
  lock(tx: postgres.TransactionSql, id: string): Promise<UserRecord | null> {
    return this.repo.lock(tx, id);
  }

  /** ADR-0030: clears every personal field and marks the account deleted, once. */
  anonymise(tx: postgres.TransactionSql, id: string, at: Date): Promise<boolean> {
    return this.repo.anonymise(tx, id, at);
  }
}
