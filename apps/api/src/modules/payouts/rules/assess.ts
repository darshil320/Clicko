/**
 * One photographer's payouts in a batch (ADR-0026 D3), pure:
 *   net = gross − TDS − deductions recovered, never negative.
 * TDS comes first (it is statutory and cannot wait). Deductions are recovered oldest first: what
 * earlier batches carried forward, then late-delivery deductions, then penalties. Whatever does not
 * fit is carried forward to the photographer's next payout.
 */
import { roundHalfUp } from '@clickco/utils';
import type { TdsRules } from '../payouts.config';
import { assessTds, type PanFacts, type TdsAssessment, type TdsYearToDate } from './tds';

const BPS = 10_000n;

export type DeductionSource = 'SLA_BREACH' | 'PENALTY';

export interface AssessPayout {
  readonly payoutId: string;
  readonly bookingId: string;
  readonly grossPaise: bigint;
}

export interface AssessDeduction {
  readonly sourceKind: DeductionSource;
  readonly sourceId: string;
  readonly bookingId: string;
  /** The payout of the booking the deduction belongs to. */
  readonly basisPaise: bigint;
  readonly rateBps: number;
  readonly amountPaise: bigint;
}

export interface AssessInput {
  /** In the order they fell due. */
  readonly payouts: readonly AssessPayout[];
  /** Recognised now (not yet in any credited batch). */
  readonly deductions: readonly AssessDeduction[];
  /** Still owed from earlier batches. */
  readonly carryInPaise: bigint;
  readonly ytd: TdsYearToDate;
  readonly pan: PanFacts;
  readonly rules: TdsRules;
}

export interface AssessedPayout {
  readonly payoutId: string;
  readonly grossPaise: bigint;
  readonly tds: TdsAssessment;
  readonly penaltyPaise: bigint;
  /** Late-delivery deductions and amounts brought forward. */
  readonly otherPaise: bigint;
  readonly netPaise: bigint;
}

export interface PayeeAssessment {
  readonly payouts: readonly AssessedPayout[];
  readonly recognisedPaise: bigint;
  readonly appliedPaise: bigint;
  readonly carryOutPaise: bigint;
  /** The year to date after these payouts. */
  readonly ytd: TdsYearToDate;
}

/** `rateBps` of the booking's payout, rounded half-up once. */
export function deductionAmount(basisPaise: bigint, rateBps: number): bigint {
  return roundHalfUp(basisPaise * BigInt(rateBps), BPS);
}

interface Pool {
  readonly column: 'penalty' | 'other';
  readonly remaining: bigint;
}

const min = (a: bigint, b: bigint): bigint => (a < b ? a : b);

/** Takes up to `room` from the pools in order; returns what was taken and the pools left. */
function drain(
  pools: readonly Pool[],
  room: bigint,
): { penalty: bigint; other: bigint; pools: Pool[] } {
  return pools.reduce(
    (acc, pool) => {
      const left = room - acc.penalty - acc.other;
      const take = min(left, pool.remaining);
      return {
        penalty: acc.penalty + (pool.column === 'penalty' ? take : 0n),
        other: acc.other + (pool.column === 'other' ? take : 0n),
        pools: [...acc.pools, { ...pool, remaining: pool.remaining - take }],
      };
    },
    { penalty: 0n, other: 0n, pools: [] as Pool[] },
  );
}

export function assessPayee(input: AssessInput): PayeeAssessment {
  if (input.carryInPaise < 0n) throw new RangeError('assessPayee: negative carry-in');
  if (input.deductions.some((d) => d.amountPaise < 0n)) {
    throw new RangeError('assessPayee: negative deduction');
  }
  const recognisedPaise = input.deductions.reduce((sum, d) => sum + d.amountPaise, 0n);
  const initialPools: Pool[] = [
    { column: 'other', remaining: input.carryInPaise },
    ...input.deductions
      .filter((d) => d.sourceKind === 'SLA_BREACH')
      .map((d): Pool => ({ column: 'other', remaining: d.amountPaise })),
    ...input.deductions
      .filter((d) => d.sourceKind === 'PENALTY')
      .map((d): Pool => ({ column: 'penalty', remaining: d.amountPaise })),
  ];

  const result = input.payouts.reduce(
    (acc, p) => {
      const tds = assessTds(p.grossPaise, acc.ytd, input.pan, input.rules);
      const taken = drain(acc.pools, p.grossPaise - tds.tdsPaise);
      const assessed: AssessedPayout = {
        payoutId: p.payoutId,
        grossPaise: p.grossPaise,
        tds,
        penaltyPaise: taken.penalty,
        otherPaise: taken.other,
        netPaise: p.grossPaise - tds.tdsPaise - taken.penalty - taken.other,
      };
      return {
        payouts: [...acc.payouts, assessed],
        pools: taken.pools,
        ytd: {
          grossPaise: acc.ytd.grossPaise + p.grossPaise,
          coveredPaise: acc.ytd.coveredPaise + tds.basePaise,
        },
      };
    },
    { payouts: [] as AssessedPayout[], pools: initialPools, ytd: input.ytd },
  );

  const appliedPaise = result.payouts.reduce((s, p) => s + p.penaltyPaise + p.otherPaise, 0n);
  return {
    payouts: result.payouts,
    recognisedPaise,
    appliedPaise,
    carryOutPaise: result.pools.reduce((s, pool) => s + pool.remaining, 0n),
    ytd: result.ytd,
  };
}
