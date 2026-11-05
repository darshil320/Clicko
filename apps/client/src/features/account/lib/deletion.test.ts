import { ApiError } from '@clickco/api-client';
import type { AccountDeletionBlocker, BookingSummary } from '@clickco/contracts';
import { describe, expect, it } from 'vitest';
import { blockerView, deletionFailure, forfeitLine } from './deletion';

const BOOKING_ID = '2c9e7f1a-5b3d-4e8f-9a0b-1c2d3e4f5a6b';

const blocker = (overrides: Partial<AccountDeletionBlocker> = {}): AccountDeletionBlocker => ({
  kind: 'BOOKING_IN_PROGRESS',
  bookingId: BOOKING_ID,
  reference: 'CLK-8F3K2Q',
  message:
    'CLK-8F3K2Q is paid and not finished yet. You can delete your account once it is, or contact support.',
  ...overrides,
});

/** Only the fields the blocker card reads; the rest of the summary is irrelevant here. */
const booking = (id: string, scheduledStart: string) =>
  ({ id, scheduledStart }) as unknown as BookingSummary;

// 12 Nov, 4:30 pm IST
const ON_12_NOV = [booking(BOOKING_ID, '2026-11-12T11:00:00.000Z')];

const http = (status: number, code: string, message = 'x') =>
  new ApiError({ kind: 'HTTP', status, code, message });

describe('blockerView: each blocker with a way forward', () => {
  it('names the booking by its date and links to it', () => {
    expect(blockerView(blocker(), ON_12_NOV)).toEqual({
      key: `BOOKING_IN_PROGRESS:${BOOKING_ID}`,
      title: 'You have a booking on 12 Nov',
      body: "You can delete your account after it's done.",
      bookingId: BOOKING_ID,
      actionLabel: 'View booking',
    });
  });

  it.each([
    ['PHOTOS_AVAILABLE', 'Your photos from 12 Nov can still be downloaded', 'Save them first'],
    ['PAYMENT_IN_PROGRESS', 'A payment for your booking on 12 Nov', 'Cancel that booking'],
    ['MONEY_BEING_SETTLED', 'Money on your booking on 12 Nov is still being settled', 'once it'],
  ] as const)('%s says what is in the way and what to do', (kind, title, body) => {
    const view = blockerView(blocker({ kind }), ON_12_NOV);
    expect(view.title).toContain(title);
    expect(view.body).toContain(body);
    expect(view.bookingId).toBe(BOOKING_ID);
  });

  it("falls back to the API's own sentence when the booking isn't in the list", () => {
    const view = blockerView(blocker(), []);
    expect(view.title).toBe('Booking CLK-8F3K2Q');
    expect(view.body).toBe(blocker().message);
    expect(blockerView(blocker(), undefined).body).toBe(blocker().message);
  });

  it('keys two blockers on the same booking apart', () => {
    const a = blockerView(blocker(), ON_12_NOV);
    const b = blockerView(blocker({ kind: 'MONEY_BEING_SETTLED' }), ON_12_NOV);
    expect(a.key).not.toBe(b.key);
  });
});

describe('forfeitLine', () => {
  it('says the unused credit that is lost, in rupees, or nothing', () => {
    expect(forfeitLine(50_000)).toBe("You'll lose ₹500 of unused Clickco credit.");
    expect(forfeitLine(1_25_000_50)).toBe("You'll lose ₹1,25,000.50 of unused Clickco credit.");
    expect(forfeitLine(0)).toBeNull();
  });
});

describe('deletionFailure: every refusal and code error in plain words', () => {
  it('a new blocker sends the client back to the explanation, saying nothing was deleted', () => {
    const failure = deletionFailure(
      http(409, 'ACCOUNT_DELETION_BLOCKED', 'CLK-8F3K2Q is paid and not finished yet.'),
    );
    expect(failure.next).toBe('blocked');
    expect(failure.message).toContain('Nothing was deleted');
  });

  it('a wrong or expired code asks for the code again, not a sign-in', () => {
    expect(deletionFailure(http(422, 'OTP_INVALID', 'The code is invalid or has expired'))).toEqual(
      {
        message: "That code isn't right, or it has expired. Check the SMS, or send a new code.",
        next: 'code',
      },
    );
  });

  it("keeps the API's own words for rate limits and SMS trouble, and lets the client retry", () => {
    expect(
      deletionFailure(http(429, 'RATE_LIMITED', 'Please wait before requesting another code')),
    ).toEqual({ message: 'Please wait before requesting another code', next: 'retry' });
    expect(
      deletionFailure(
        http(
          503,
          'SMS_UNAVAILABLE',
          'We could not send the code right now. Please try again shortly.',
        ),
      ).next,
    ).toBe('retry');
    expect(
      deletionFailure(http(429, 'RATE_LIMITED', 'ThrottlerException: Too Many Requests')),
    ).toEqual({ message: 'Too many tries. Please wait a minute and try again.', next: 'retry' });
  });

  it.each([
    ['ACCOUNT_BLOCKED', 403, 'final', 'on hold'],
    ['SESSION_INVALID', 401, 'final', 'Sign in again'],
    ['IDEMPOTENCY_REQUEST_IN_PROGRESS', 409, 'retry', 'still working'],
  ] as const)('%s → %s', (code, status, next, words) => {
    const failure = deletionFailure(http(status, code, 'SomeException'));
    expect(failure.next).toBe(next);
    expect(failure.message).toContain(words);
    expect(failure.message).not.toContain(code);
  });

  it('offline and server trouble are worth a retry; other client errors are final', () => {
    expect(
      deletionFailure(new ApiError({ kind: 'NETWORK', status: 0, code: 'TIMEOUT', message: 'x' })),
    ).toEqual({
      message: 'Clickco is taking too long to respond. Check your connection and try again.',
      next: 'retry',
    });
    expect(deletionFailure(http(500, 'ERROR')).next).toBe('retry');
    expect(deletionFailure(http(403, 'CLIENTS_ONLY', 'Only client accounts can use this'))).toEqual(
      { message: 'Only client accounts can use this', next: 'final' },
    );
  });
});
