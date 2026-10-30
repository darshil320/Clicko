import { describe, expect, it } from 'vitest';
import { TDS_RULES } from '../payouts.config';
import { type AssessInput, assessPayee, deductionAmount } from '../rules/assess';

const R = (rupees: number): bigint => BigInt(Math.round(rupees * 100));
const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const pan = { pan: 'ABCPE1234F', verified: true } as const;

const input = (over: Partial<AssessInput> = {}): AssessInput => ({
  payouts: [{ payoutId: A, bookingId: A, grossPaise: R(2_000) }],
  deductions: [],
  carryInPaise: 0n,
  ytd: { grossPaise: 0n, coveredPaise: 0n },
  pan,
  rules: TDS_RULES,
  ...over,
});

const breach = (rateBps: number, basisPaise = R(2_000)) => ({
  sourceKind: 'SLA_BREACH' as const,
  sourceId: A,
  bookingId: A,
  basisPaise,
  rateBps,
  amountPaise: deductionAmount(basisPaise, rateBps),
});

describe('deductions are a percentage of the booking payout, rounded half-up once', () => {
  it('25 % of ₹2,000 is ₹500; 12.5 % of ₹0.03 rounds to ₹0.00', () => {
    expect(deductionAmount(R(2_000), 2_500)).toBe(R(500));
    expect(deductionAmount(3n, 1_250)).toBe(0n);
    expect(deductionAmount(5n, 1_000)).toBe(1n);
  });
});

describe('assessing one photographer’s payouts in a batch (ADR-0026 D3)', () => {
  it('nothing to take off: the photographer gets the whole payout', () => {
    const out = assessPayee(input());
    expect(out.payouts).toEqual([
      {
        payoutId: A,
        grossPaise: R(2_000),
        tds: { section: null, rateBps: 0, tdsPaise: 0n, basePaise: 0n },
        penaltyPaise: 0n,
        otherPaise: 0n,
        netPaise: R(2_000),
      },
    ]);
    expect(out.carryOutPaise).toBe(0n);
  });

  it('a late-delivery deduction comes off as "other"; a penalty as "penalty"', () => {
    const penalty = { ...breach(1_000), sourceKind: 'PENALTY' as const, sourceId: B };
    const out = assessPayee(input({ deductions: [breach(2_500), penalty] }));
    expect(out.payouts[0]).toMatchObject({
      otherPaise: R(500),
      penaltyPaise: R(200),
      netPaise: R(1_300),
    });
    expect(out.recognisedPaise).toBe(R(700));
    expect(out.appliedPaise).toBe(R(700));
  });

  it('never negative: a shortfall is carried forward to the next payout', () => {
    const out = assessPayee(input({ deductions: [breach(7_500)], carryInPaise: R(1_000) }));
    expect(out.payouts[0]?.netPaise).toBe(0n);
    expect(out.payouts[0]?.otherPaise).toBe(R(2_000));
    expect(out.carryOutPaise).toBe(R(500));
  });

  it('what was carried forward is recovered first', () => {
    const out = assessPayee(input({ carryInPaise: R(300) }));
    expect(out.payouts[0]).toMatchObject({ otherPaise: R(300), netPaise: R(1_700) });
    expect(out.carryOutPaise).toBe(0n);
  });

  it('TDS comes first; deductions only take what is left', () => {
    const out = assessPayee(
      input({
        payouts: [{ payoutId: A, bookingId: A, grossPaise: R(40_000) }],
        deductions: [breach(10_000, R(40_000))],
      }),
    );
    expect(out.payouts[0]).toMatchObject({
      tds: { tdsPaise: R(400) },
      otherPaise: R(39_600),
      netPaise: 0n,
    });
    expect(out.carryOutPaise).toBe(R(400));
  });

  it('several payouts: the year to date runs through them in order', () => {
    const out = assessPayee(
      input({
        payouts: [
          { payoutId: A, bookingId: A, grossPaise: R(60_000) },
          { payoutId: B, bookingId: B, grossPaise: R(50_000) },
        ],
      }),
    );
    expect(out.payouts.map((p) => p.tds.tdsPaise)).toEqual([R(600), R(500)]);
    expect(out.ytd).toEqual({ grossPaise: R(1_10_000), coveredPaise: R(1_10_000) });
  });

  it('a deduction spills over to the photographer’s next payout in the same batch', () => {
    const out = assessPayee(
      input({
        payouts: [
          { payoutId: A, bookingId: A, grossPaise: R(1_000) },
          { payoutId: B, bookingId: B, grossPaise: R(3_000) },
        ],
        deductions: [breach(7_500, R(2_000)), breach(0)],
      }),
    );
    expect(out.payouts.map((p) => p.netPaise)).toEqual([0n, R(2_500)]);
    expect(out.payouts.map((p) => p.otherPaise)).toEqual([R(1_000), R(500)]);
    expect(out.carryOutPaise).toBe(0n);
  });
});
