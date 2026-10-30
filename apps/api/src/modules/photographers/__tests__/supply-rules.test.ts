import { describe, expect, it } from 'vitest';
import {
  covers,
  isDocumentExpired,
  istToday,
  KYC_LINK_TTL_MS,
  kycLinkExpiry,
  missingChecks,
  missingChecksMessage,
  verificationEffect,
} from '../supply-rules';

describe('verificationEffect (ADR-0026 D5: approving a document ticks a manual check)', () => {
  it('maps each identity document to the identity check', () => {
    for (const kind of ['DRIVING_LICENCE', 'PASSPORT', 'VOTER_ID'] as const) {
      expect(verificationEffect(kind)).toBe('IDENTITY');
    }
  });

  it('maps PAN, bank proof and police verification to their checks', () => {
    expect(verificationEffect('PAN_CARD')).toBe('PAN');
    expect(verificationEffect('BANK_PROOF')).toBe('BANK');
    expect(verificationEffect('POLICE_VERIFICATION')).toBe('POLICE');
  });

  it('leaves the other documents as records only', () => {
    for (const kind of [
      'ADDRESS_PROOF',
      'GST_CERTIFICATE',
      'DRONE_RPC',
      'DRONE_UIN',
      'EQUIPMENT_INVOICE',
      'SIGNED_CONTRACT',
      'OTHER',
    ] as const) {
      expect(verificationEffect(kind)).toBeNull();
    }
  });
});

describe('document expiry (IST calendar days)', () => {
  it('is the IST day, not the UTC one', () => {
    expect(istToday(new Date('2026-10-30T18:29:59.000Z'))).toBe('2026-10-30');
    expect(istToday(new Date('2026-10-30T18:30:00.000Z'))).toBe('2026-10-31');
  });

  it('a document expiring today is still valid; yesterday is expired; none never expires', () => {
    expect(isDocumentExpired('2026-10-30', '2026-10-30')).toBe(false);
    expect(isDocumentExpired('2026-10-29', '2026-10-30')).toBe(true);
    expect(isDocumentExpired(null, '2026-10-30')).toBe(false);
  });
});

describe('KYC document links', () => {
  it('live exactly five minutes', () => {
    expect(KYC_LINK_TTL_MS).toBe(300_000);
    expect(kycLinkExpiry(new Date('2026-10-30T10:00:00.000Z')).toISOString()).toBe(
      '2026-10-30T10:05:00.000Z',
    );
  });
});

describe('verification checks before ACTIVE', () => {
  const none = {
    identityConfirmedAt: null,
    idProofKind: null,
    idProofLast4: null,
    policeVerificationAt: null,
    policeVerificationExpires: null,
    panVerifiedAt: null,
    panNumber: null,
    bankVerifiedAt: null,
    isGstRegistered: false,
  };

  it('lists every missing check, and none once all four are ticked', () => {
    expect(missingChecks(none)).toEqual(['IDENTITY', 'POLICE', 'PAN', 'BANK']);
    const at = new Date('2026-10-30T10:00:00.000Z');
    expect(
      missingChecks({
        ...none,
        identityConfirmedAt: at,
        policeVerificationAt: '2026-10-01',
        panVerifiedAt: at,
        bankVerifiedAt: at,
      }),
    ).toEqual([]);
  });

  it('says what to approve in plain words', () => {
    expect(missingChecksMessage(['PAN'])).toBe('Approve the PAN card first');
    expect(missingChecksMessage(['PAN', 'BANK'])).toBe(
      'Approve the PAN card and the bank proof first',
    );
    expect(missingChecksMessage(['IDENTITY', 'POLICE', 'BANK'])).toBe(
      'Approve an identity document, the police verification and the bank proof first',
    );
  });

  it('a city scope covers its cities; ALL covers every city', () => {
    expect(covers('ALL', 'x')).toBe(true);
    expect(covers(['a', 'b'], 'b')).toBe(true);
    expect(covers(['a'], 'b')).toBe(false);
    expect(covers([], 'a')).toBe(false);
  });
});
