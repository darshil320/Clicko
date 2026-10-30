import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  AdminCreateApplicantBody,
  AdminKycDecisionBody,
  AdminMoveApplicationBody,
  APPLICATION_BOARD_STAGES,
  APPLICATION_CLOSED_STAGES,
  ApplicationStage,
  canMoveApplication,
  DocumentKind,
  DocumentReviewStatus,
  maskTail,
  missingVerification,
  statusActionsFrom,
} from './admin-supply.js';

const SCHEMA_SQL = readFileSync(
  fileURLToPath(new URL('../../../docs/clickco-04-schema.sql', import.meta.url)),
  'utf8',
);

function sqlEnum(name: string): string[] {
  const match = SCHEMA_SQL.match(new RegExp(`CREATE TYPE ${name} AS ENUM \\(([^;]*)\\);`));
  if (!match?.[1]) throw new Error(`enum ${name} not found in schema`);
  return [...match[1].matchAll(/'([A-Z0-9_]+)'/g)].map((m) => m[1] as string);
}

describe('supply enums mirror docs/clickco-04-schema.sql', () => {
  it.each([
    ['application_stage', ApplicationStage],
    ['document_kind', DocumentKind],
    ['document_review_status', DocumentReviewStatus],
  ] as const)('%s', (sqlName, schema) => {
    expect(schema.options).toEqual(sqlEnum(sqlName));
  });

  it('never knows an Aadhaar document (Invariant 15)', () => {
    expect(DocumentKind.options.some((k) => k.includes('AADHAAR'))).toBe(false);
  });

  it('the board and closed stages cover every stage exactly once', () => {
    expect([...APPLICATION_BOARD_STAGES, ...APPLICATION_CLOSED_STAGES].sort()).toEqual(
      [...ApplicationStage.options].sort(),
    );
  });
});

describe('canMoveApplication (ADR-0026 D5 kanban)', () => {
  it('moves freely between in-flight stages and out to a decision', () => {
    expect(canMoveApplication('APPLIED', 'SCREENING')).toBe(true);
    expect(canMoveApplication('TRIAL_REVIEW', 'SCREENING')).toBe(true);
    expect(canMoveApplication('CONTRACT_SENT', 'APPROVED')).toBe(true);
    expect(canMoveApplication('SCREENING', 'REJECTED')).toBe(true);
    expect(canMoveApplication('ON_HOLD', 'WITHDRAWN')).toBe(true);
  });

  it('refuses a move to the same stage', () => {
    expect(canMoveApplication('SCREENING', 'SCREENING')).toBe(false);
  });

  it('never leaves APPROVED (the photographer status takes over)', () => {
    for (const to of ApplicationStage.options)
      expect(canMoveApplication('APPROVED', to)).toBe(false);
  });

  it('reopens a rejected or withdrawn application into an in-flight stage only', () => {
    expect(canMoveApplication('REJECTED', 'SCREENING')).toBe(true);
    expect(canMoveApplication('WITHDRAWN', 'APPLIED')).toBe(true);
    expect(canMoveApplication('REJECTED', 'APPROVED')).toBe(false);
    expect(canMoveApplication('WITHDRAWN', 'REJECTED')).toBe(false);
  });
});

describe('photographer status actions', () => {
  it('offers what each status can do', () => {
    expect(statusActionsFrom('ACTIVE')).toEqual(['PAUSE', 'SUSPEND', 'OFFBOARD']);
    expect(statusActionsFrom('PAUSED')).toEqual(['REACTIVATE', 'SUSPEND', 'OFFBOARD']);
    expect(statusActionsFrom('SUSPENDED')).toEqual(['REACTIVATE', 'OFFBOARD']);
    expect(statusActionsFrom('OFFBOARDED')).toEqual([]);
    expect(statusActionsFrom('APPLICANT')).toEqual([]);
  });
});

describe('verification and masking', () => {
  const none = {
    identityConfirmedAt: null,
    idProofKind: null,
    idProofMasked: null,
    policeVerifiedOn: null,
    policeVerificationExpires: null,
    panVerifiedAt: null,
    panMasked: null,
    bankVerifiedAt: null,
    gstRegistered: false,
  };

  it('lists the checks still missing before a photographer can go ACTIVE', () => {
    expect(missingVerification(none)).toEqual(['IDENTITY', 'POLICE', 'PAN', 'BANK']);
    expect(
      missingVerification({
        ...none,
        identityConfirmedAt: '2026-10-30T10:00:00+05:30',
        policeVerifiedOn: '2026-10-01',
        panVerifiedAt: '2026-10-30T10:00:00+05:30',
      }),
    ).toEqual(['BANK']);
  });

  it('shows only the last four characters', () => {
    expect(maskTail('ABCDE1234F')).toBe('•••• 234F');
    expect(maskTail('1234')).toBe('•••• 1234');
  });
});

describe('supply bodies', () => {
  it('a move needs a reason', () => {
    expect(AdminMoveApplicationBody.safeParse({ toStage: 'SCREENING', note: '' }).success).toBe(
      false,
    );
    expect(
      AdminMoveApplicationBody.safeParse({ toStage: 'SCREENING', note: 'Portfolio looks good' })
        .success,
    ).toBe(true);
  });

  it('a KYC rejection says why; an approval need not', () => {
    expect(AdminKycDecisionBody.safeParse({ decision: 'APPROVE' }).success).toBe(true);
    expect(AdminKycDecisionBody.safeParse({ decision: 'REJECT' }).success).toBe(false);
    expect(AdminKycDecisionBody.safeParse({ decision: 'REJECT', note: 'Blurred' }).success).toBe(
      true,
    );
  });

  it('a portfolio link is http(s) only', () => {
    const base = {
      fullName: 'Asha Patel',
      phone: '+919825000001',
      cityId: '7d9f3c1a-2b4e-4c8d-9f10-1a2b3c4d5e6f',
      source: 'WALK_IN',
    };
    expect(AdminCreateApplicantBody.safeParse(base).success).toBe(true);
    expect(
      AdminCreateApplicantBody.safeParse({ ...base, portfolioUrl: 'https://insta.example/asha' })
        .success,
    ).toBe(true);
    expect(
      AdminCreateApplicantBody.safeParse({ ...base, portfolioUrl: 'javascript:alert(1)' }).success,
    ).toBe(false);
  });
});
