import type {
  AccountDeletionBlocker,
  AccountDeletionChallenge,
  AccountDeletionPreview,
  AccountDeletionResult,
  ConfirmAccountDeletionBody,
} from '@clickco/contracts';
import { fromPaiseBigint } from '@clickco/utils';
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type postgres from 'postgres';
import { CLOCK, type Clock } from '../../common/clock';
import { IdempotencyStore } from '../../common/idempotency/idempotency.store';
import { SQL } from '../../infra/db/db.module';
import { appendDomainEvent } from '../../infra/outbox/outbox';
import { AuthAccountErasure } from '../auth/account-erasure';
import { OtpService } from '../auth/otp.service';
import { BookingPrivacyService } from '../bookings/booking-privacy.service';
import { NotificationAccountErasure } from '../notifications/account-erasure';
import { PaymentAccountErasure } from '../payments/account-erasure';
import { CreditsService } from '../refunds/credits.service';
import { RefundsService } from '../refunds/refunds.service';
import { ReviewsService as ReviewItemsService } from '../refunds/reviews.service';
import { ReviewAccountErasure } from '../reviews/review-erasure';
import { ClientSafetyErasure } from '../safety/client-erasure';
import { WaitlistErasure } from '../serviceability/waitlist-erasure';
import type { UserRecord } from '../users/repositories/users.repository';
import { UsersService } from '../users/users.service';
import { blockersFor, DELETION_ERASES, DELETION_KEEPS, forfeitedCredit } from './deletion-rules';

/** A refund in any of these is money still owed to (or being worked out with) the client. */
const UNSETTLED_REFUNDS = ['REQUESTED', 'APPROVED', 'PROCESSING', 'FAILED'] as const;
/** More than any one client has; the page is only read for the booking ids. */
const PAGE = 500;

const SESSION_INVALID = { code: 'SESSION_INVALID', message: 'Please sign in again' };
const BLOCKED = { code: 'ACCOUNT_BLOCKED', message: 'This account is blocked' };
/** Not a 401: a wrong code must not look like an expired session to the app (it would refresh). */
const OTP_INVALID = { code: 'OTP_INVALID', message: 'The code is invalid or has expired' };

const refused = (blockers: readonly AccountDeletionBlocker[]) =>
  new ConflictException({
    code: 'ACCOUNT_DELETION_BLOCKED',
    message: blockers.map((b) => b.message).join(' '),
    details: { blockers },
  });

const done = (at: Date): AccountDeletionResult => ({
  deleted: true,
  deletedAt: at.toISOString(),
});

/**
 * ADR-0030 — a client deletes their own account. Refused while a paid booking is unfinished or
 * money is still being settled (a refund, or an open review item on "To settle"); confirmed with
 * a fresh code sent to the account's own phone; then, in one transaction, every personal field is
 * erased through the module that owns it, every session is revoked and `user.deleted` is written
 * to the outbox. What the law keeps (invoices, payments, credit notes, ledger, audit) keeps
 * pointing at the same, now anonymous, account. Lock order: the client's bookings, then the
 * account, then the bookings again (a payment in flight holds its booking, then the account's key).
 */
@Injectable()
export class AccountDeletionService {
  constructor(
    @Inject(SQL) private readonly sql: postgres.Sql,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(UsersService) private readonly users: UsersService,
    @Inject(OtpService) private readonly otp: OtpService,
    @Inject(AuthAccountErasure) private readonly auth: AuthAccountErasure,
    @Inject(BookingPrivacyService) private readonly bookings: BookingPrivacyService,
    @Inject(RefundsService) private readonly refunds: RefundsService,
    @Inject(CreditsService) private readonly credits: CreditsService,
    @Inject(ReviewItemsService) private readonly reviewItems: ReviewItemsService,
    @Inject(PaymentAccountErasure) private readonly payments: PaymentAccountErasure,
    @Inject(IdempotencyStore) private readonly idempotency: IdempotencyStore,
    @Inject(NotificationAccountErasure) private readonly notifications: NotificationAccountErasure,
    @Inject(ClientSafetyErasure) private readonly safety: ClientSafetyErasure,
    @Inject(ReviewAccountErasure) private readonly reviews: ReviewAccountErasure,
    @Inject(WaitlistErasure) private readonly waitlist: WaitlistErasure,
  ) {}

  /** What deleting does and whether it can happen now. No side effects. */
  async preview(userId: string): Promise<AccountDeletionPreview> {
    const [blockers, credit] = await Promise.all([
      this.blockers(userId),
      this.forfeitedCredit(userId),
    ]);
    return {
      canDelete: blockers.length === 0,
      blockers,
      erases: [...DELETION_ERASES],
      keeps: [...DELETION_KEEPS],
      forfeitedCreditPaise: fromPaiseBigint(credit),
    };
  }

  /** Sends the code to the account's own phone; nothing is sent while deletion is refused. */
  async request(userId: string, ip: string | null): Promise<AccountDeletionChallenge> {
    const user = this.live(await this.users.findById(userId));
    const blockers = await this.blockers(userId);
    if (blockers.length > 0) throw refused(blockers);
    return this.otp.request(user.phone, 'ACCOUNT_DELETE', ip);
  }

  /**
   * Idempotent by state as well as by key: an account already deleted answers with its deletion
   * time (a retry whose first answer was lost), whatever the code. The code is checked (and used
   * up) only once nothing blocks the deletion under the locks, so a refusal leaves it usable.
   */
  async confirm(userId: string, body: ConfirmAccountDeletionBody): Promise<AccountDeletionResult> {
    const known = await this.users.findById(userId);
    if (known?.deletedAt) return done(known.deletedAt);
    this.live(known);
    const blockers = await this.blockers(userId);
    if (blockers.length > 0) throw refused(blockers);
    const deletedAt = await this.sql.begin((tx) => this.erase(tx, userId, body));
    return done(deletedAt);
  }

  private async erase(
    tx: postgres.TransactionSql,
    userId: string,
    body: ConfirmAccountDeletionBody,
  ): Promise<Date> {
    await this.bookings.lockForClient(tx, userId);
    const user = await this.users.lock(tx, userId);
    if (user?.deletedAt) return user.deletedAt; // a concurrent confirm got here first
    const live = this.live(user);
    // Under the account lock no booking can be added: re-read the complete, locked set.
    const bookings = await this.bookings.lockForClient(tx, userId);
    const blockers = blockersFor(bookings, await this.unsettledBookings(userId));
    if (blockers.length > 0) throw refused(blockers);
    await this.verify(body, live.phone);

    const at = this.clock();
    const ids = bookings.map((b) => b.bookingId);
    const booked = await this.bookings.eraseClient(tx, userId, bookings, at);
    const reviews = await this.reviews.eraseClient(tx, ids, at);
    const safety = await this.safety.eraseClient(tx, userId, reviews.reviewIds);
    const notifications = await this.notifications.eraseClient(tx, userId);
    const waitlist = await this.waitlist.eraseForPhone(tx, live.phone);
    const payments = await this.payments.maskClient(tx, userId);
    const answers = await this.idempotency.forgetOwner(tx, `USER:${userId}`);
    const auth = await this.auth.eraseClient(tx, userId, live.phone, at);
    if (!(await this.users.anonymise(tx, userId, at))) throw new Error('anonymise: no row');
    // Counts only: never a name, number or address in the event.
    await appendDomainEvent(tx, {
      eventType: 'user.deleted',
      aggregateKind: 'user',
      aggregateId: userId,
      occurredAt: at,
      payload: {
        user_id: userId,
        deleted_at: at.toISOString(),
        bookings_erased: booked.erased,
        bookings_cancelled: booked.cancelled,
        review_comments_cleared: reviews.commentsCleared,
        reviews_about_client_removed: reviews.aboutClientRemoved,
        report_notes_cleared: safety.reportNotes,
        report_review_copies_cleared: safety.reviewCopies,
        blocks_removed: safety.blocks,
        push_tokens_removed: notifications.pushTokens,
        preferences_removed: notifications.preferences,
        waitlist_entries_removed: waitlist,
        payments_masked: payments,
        stored_answers_removed: answers,
        otp_challenges_removed: auth.otpChallenges,
        sessions_revoked: auth.sessions,
      },
    });
    return at;
  }

  private async verify(body: ConfirmAccountDeletionBody, phone: string): Promise<void> {
    try {
      await this.otp.verify(body.challengeId, phone, 'ACCOUNT_DELETE', body.code);
    } catch (error) {
      if (error instanceof UnauthorizedException)
        throw new UnprocessableEntityException(OTP_INVALID);
      throw error;
    }
  }

  /** A signed-in client who can act: not gone, not blocked, with a phone. */
  private live(user: UserRecord | null): UserRecord & { readonly phone: string } {
    if (!user?.phone || user.deletedAt) throw new UnauthorizedException(SESSION_INVALID);
    if (user.isBlocked) throw new ForbiddenException(BLOCKED);
    return { ...user, phone: user.phone };
  }

  private async blockers(userId: string): Promise<AccountDeletionBlocker[]> {
    const [bookings, unsettled] = await Promise.all([
      this.bookings.forClient(userId),
      this.unsettledBookings(userId),
    ]);
    return blockersFor(bookings, unsettled);
  }

  /**
   * The client's bookings with money still being settled: a refund not finished, or an open
   * review item on "To settle" (a refund or credit due, a remainder, a charge to decide).
   */
  private async unsettledBookings(userId: string): Promise<string[]> {
    const [refunds, items] = await Promise.all([
      this.refunds.page({
        statuses: UNSETTLED_REFUNDS,
        bookings: this.bookings.idsForClient(userId),
        oldestFirst: true,
        limit: PAGE,
      }),
      this.reviewItems.page({
        bookings: this.bookings.idsForClient(userId),
        status: 'OPEN',
        limit: PAGE,
      }),
    ]);
    return [
      ...new Set([
        ...refunds.map((r) => r.bookingId),
        ...items.flatMap((i) => (i.bookingId ? [i.bookingId] : [])),
      ]),
    ];
  }

  private async forfeitedCredit(userId: string): Promise<bigint> {
    const rows = await this.credits.page({
      bookings: this.bookings.idsForClient(userId),
      limit: PAGE,
    });
    return forfeitedCredit(
      rows.filter((c) => c.userId === userId),
      this.clock(),
    );
  }
}
