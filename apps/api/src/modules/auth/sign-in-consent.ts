import { SIGN_IN_NOTICE_VERSION, type SignInConsent } from '@clickco/contracts';
import { UnprocessableEntityException } from '@nestjs/common';
import type postgres from 'postgres';
import { appendDomainEvent } from '../../infra/outbox/outbox';

/** The consent log's event (DOMAIN §3): append-only, in the outbox, no personal data. */
export const CONSENT_RECORDED_EVENT = 'user.consent_recorded';

/** What was agreed to: the privacy notice shown on the sign-in screen. */
export const SIGN_IN_NOTICE_PURPOSE = 'SIGN_IN_NOTICE';

/** Whose consent: a client account, or a photographer (the Pro app). */
export type ConsentAggregate = 'user' | 'photographer';

/**
 * DPDP Act 2023 s.6 and s.9: a sign-in that creates an account (or a photographer's first) needs
 * the "I am 18 or older and agree" checkbox. The apps show this sentence as is.
 */
export const consentRequired = (): UnprocessableEntityException =>
  new UnprocessableEntityException({
    code: 'CONSENT_REQUIRED',
    message: 'Confirm you are 18 or older and agree to the Privacy Policy to continue.',
  });

/**
 * Consent counts only for the notice in force: a stale, future or made-up version is treated as
 * no consent, so the log never records a version that was not shown (s.6(10)).
 */
export function currentConsent(consent: SignInConsent | undefined): SignInConsent | undefined {
  return consent?.noticeVersion === SIGN_IN_NOTICE_VERSION ? consent : undefined;
}

/**
 * Appends the consent-log entry in the caller's transaction (the one that writes the session and,
 * for a new client, the account), so the proof of consent commits or rolls back with the sign-in.
 * s.6(10) puts the burden of proving consent on us. The payload never carries a phone, name or IP.
 */
export async function recordSignInConsent(
  tx: postgres.TransactionSql,
  aggregate: { readonly kind: ConsentAggregate; readonly id: string },
  consent: SignInConsent,
  occurredAt: Date,
): Promise<void> {
  await appendDomainEvent(tx, {
    eventType: CONSENT_RECORDED_EVENT,
    aggregateKind: aggregate.kind,
    aggregateId: aggregate.id,
    payload: {
      purpose: SIGN_IN_NOTICE_PURPOSE,
      adultConfirmed: consent.adultConfirmed,
      noticeVersion: consent.noticeVersion,
    },
    occurredAt,
  });
}
