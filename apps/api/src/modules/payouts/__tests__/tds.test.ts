import { describe, expect, it } from 'vitest';
import { TDS_RULES } from '../payouts.config';
import { assessTds, hasValidPan, tdsRateFor, yearToDate } from '../rules/tds';

const R = (rupees: number): bigint => BigInt(Math.round(rupees * 100));
const individual = { pan: 'ABCPE1234F', verified: true } as const;
const company = { pan: 'ABCCE1234F', verified: true } as const;
const noPan = { pan: null, verified: false } as const;
const fresh = { grossPaise: 0n, coveredPaise: 0n };

describe('the deductee and the rate (s.194C, s.206AA)', () => {
  it('individuals and HUFs pay 1 %, every other PAN holder 2 %', () => {
    expect(tdsRateFor({ pan: 'ABCPE1234F', verified: true }, TDS_RULES).rateBps).toBe(100);
    expect(tdsRateFor({ pan: 'ABCHE1234F', verified: true }, TDS_RULES).rateBps).toBe(100);
    expect(tdsRateFor({ pan: 'ABCCE1234F', verified: true }, TDS_RULES).rateBps).toBe(200);
    expect(tdsRateFor({ pan: 'ABCFE1234F', verified: true }, TDS_RULES).rateBps).toBe(200);
    expect(tdsRateFor({ pan: 'ABCTE1234F', verified: true }, TDS_RULES)).toEqual({
      rateBps: 200,
      basis: 'OTHER',
    });
  });

  it('20 % without a valid PAN: missing, unverified or malformed', () => {
    expect(tdsRateFor(noPan, TDS_RULES)).toEqual({ rateBps: 2_000, basis: 'NO_PAN' });
    expect(tdsRateFor({ pan: 'ABCPE1234F', verified: false }, TDS_RULES).rateBps).toBe(2_000);
    expect(tdsRateFor({ pan: 'abcpe1234f', verified: true }, TDS_RULES).rateBps).toBe(2_000);
    expect(hasValidPan({ pan: 'ABCPE1234', verified: true })).toBe(false);
    expect(hasValidPan(individual)).toBe(true);
  });
});

describe('the ₹30,000 single-payment threshold', () => {
  it('a payment of exactly ₹30,000 has no TDS', () => {
    expect(assessTds(R(30_000), fresh, individual, TDS_RULES)).toEqual({
      section: null,
      rateBps: 0,
      tdsPaise: 0n,
      basePaise: 0n,
    });
  });

  it('one paisa over: TDS on the whole payment, rounded to the rupee', () => {
    expect(assessTds(R(30_000) + 1n, fresh, individual, TDS_RULES)).toEqual({
      section: '194C',
      rateBps: 100,
      tdsPaise: R(300),
      basePaise: R(30_000) + 1n,
    });
  });

  it('rounds half-up to the rupee (₹300.50 → ₹301)', () => {
    expect(assessTds(R(30_050), fresh, individual, TDS_RULES).tdsPaise).toBe(R(301));
    expect(assessTds(R(30_049), fresh, individual, TDS_RULES).tdsPaise).toBe(R(300));
  });

  it('2 % for a firm, 20 % without a PAN', () => {
    expect(assessTds(R(50_000), fresh, company, TDS_RULES).tdsPaise).toBe(R(1_000));
    expect(assessTds(R(40_000), fresh, noPan, TDS_RULES)).toMatchObject({
      rateBps: 2_000,
      tdsPaise: R(8_000),
    });
  });
});

describe('the ₹1,00,000 yearly threshold', () => {
  it('a year that reaches exactly ₹1,00,000 has no TDS', () => {
    const ytd = { grossPaise: R(90_000), coveredPaise: 0n };
    expect(assessTds(R(10_000), ytd, individual, TDS_RULES).tdsPaise).toBe(0n);
  });

  it('crossing it mid-year: TDS on the whole year, recovered on this payout', () => {
    const ytd = { grossPaise: R(90_000), coveredPaise: 0n };
    expect(assessTds(R(10_000) + 1n, ytd, individual, TDS_RULES)).toEqual({
      section: '194C',
      rateBps: 100,
      tdsPaise: R(1_000),
      basePaise: R(1_00_000) + 1n,
    });
  });

  it('after crossing, each payment is taxed on itself only', () => {
    const ytd = { grossPaise: R(1_00_001), coveredPaise: R(1_00_001) };
    expect(assessTds(R(2_000), ytd, individual, TDS_RULES)).toMatchObject({
      tdsPaise: R(20),
      basePaise: R(2_000),
    });
  });

  it('never taxes twice what a large single payment already covered', () => {
    const ytd = { grossPaise: R(35_000), coveredPaise: R(35_000) };
    expect(assessTds(R(70_000), ytd, individual, TDS_RULES)).toMatchObject({
      tdsPaise: R(700),
      basePaise: R(70_000),
    });
  });

  it('a catch-up larger than the payout takes the whole payout; the rest waits for the next', () => {
    const ytd = { grossPaise: R(99_000), coveredPaise: 0n };
    const first = assessTds(R(2_000), ytd, noPan, TDS_RULES);
    expect(first).toEqual({
      section: '194C',
      rateBps: 2_000,
      tdsPaise: R(2_000),
      basePaise: R(10_000),
    });
    const next = assessTds(
      R(2_000),
      { grossPaise: R(1_01_000), coveredPaise: first.basePaise },
      noPan,
      TDS_RULES,
    );
    expect(next.tdsPaise).toBe(R(2_000));
    expect(next.basePaise).toBeGreaterThan(0n);
  });
});

describe('the financial year to date (1 April IST)', () => {
  const credited = [
    {
      grossPaise: R(60_000),
      basePaise: R(60_000),
      creditedAt: new Date('2027-03-31T18:29:59.999Z'),
    },
    { grossPaise: R(5_000), basePaise: 0n, creditedAt: new Date('2027-03-31T18:30:00.000Z') },
    { grossPaise: R(7_000), basePaise: 0n, creditedAt: new Date('2027-06-01T06:00:00.000Z') },
  ];

  it('31 March 23:59 IST belongs to the old year; 1 April 00:00 IST starts the new one', () => {
    expect(yearToDate(credited, new Date('2027-04-10T06:00:00.000Z'))).toEqual({
      grossPaise: R(12_000),
      coveredPaise: 0n,
    });
    expect(yearToDate(credited, new Date('2027-03-31T18:00:00.000Z'))).toEqual({
      grossPaise: R(60_000),
      coveredPaise: R(60_000),
    });
  });

  it('a new year starts from nothing, so the thresholds start again', () => {
    const april = yearToDate(credited, new Date('2027-04-02T00:00:00.000Z'));
    expect(assessTds(R(20_000), april, individual, TDS_RULES).tdsPaise).toBe(0n);
  });
});
