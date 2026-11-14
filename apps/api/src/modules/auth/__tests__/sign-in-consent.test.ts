import { SIGN_IN_NOTICE_VERSION } from '@clickco/contracts';
import { describe, expect, it } from 'vitest';
import { currentConsent } from '../sign-in-consent';

// DPDP s.6(10): the log must prove the notice actually shown was accepted, so a stale, future or
// made-up version counts as no consent (security review, 14 Nov 2026).
describe('currentConsent', () => {
  it('keeps consent to the notice in force', () => {
    const consent = { adultConfirmed: true as const, noticeVersion: SIGN_IN_NOTICE_VERSION };
    expect(currentConsent(consent)).toEqual(consent);
  });

  it.each(['2020-01-01', '2099-12-31'])('treats notice version %s as no consent', (version) => {
    expect(currentConsent({ adultConfirmed: true, noticeVersion: version })).toBeUndefined();
  });

  it('passes "no consent" through', () => {
    expect(currentConsent(undefined)).toBeUndefined();
  });
});
