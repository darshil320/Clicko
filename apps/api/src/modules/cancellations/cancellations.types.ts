import type { CancellationBlock } from '@clickco/contracts';
import type { LadderStep, RefundSplit } from './rules/ladder';

/** What cancelling a booking now would do, worked out from its state (read or locked). */
export type Assessment =
  | {
      readonly kind: 'UNPAID';
      readonly peakSeason: boolean;
      readonly paidPaise: bigint;
    }
  | {
      readonly kind: 'BLOCKED';
      readonly block: CancellationBlock;
      readonly peakSeason: boolean;
      readonly paidPaise: bigint;
    }
  | {
      readonly kind: 'PAID';
      readonly step: LadderStep;
      readonly split: RefundSplit;
      readonly peakSeason: boolean;
      readonly paidPaise: bigint;
      /** An authorisation never charged (sub-3-hour emergency): payments releases it in full. */
      readonly heldPaise: bigint;
    };

export type PaidAssessment = Extract<Assessment, { kind: 'PAID' }>;
