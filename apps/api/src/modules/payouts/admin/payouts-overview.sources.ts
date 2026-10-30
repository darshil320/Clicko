import type { OverviewSource } from '../../admin/overview/overview-source';
import type { PayoutsService } from '../payouts.service';

/**
 * READY TO REGISTER (not registered here, so it is never registered twice): Today's payouts
 * sources (ADR-0026 D8). Wire with
 *   for (const s of payoutsOverviewSources(payoutsService)) registry.register(s);
 * Payouts span every city, so a city-limited scope counts nothing.
 */
export function payoutsOverviewSources(payouts: PayoutsService): OverviewSource[] {
  return [
    {
      key: 'payouts.due_this_week',
      desk: 'payouts',
      count: async ({ scope, now }) =>
        scope === 'ALL' ? (await payouts.overviewCount(now)).dueThisWeek.payoutCount : 0,
      tile: {
        label: 'Payouts this week',
        hint: "Photographer payouts due before Monday's run",
        order: 90,
      },
    },
    {
      key: 'payouts.awaiting_payment',
      desk: 'payouts',
      count: async ({ scope, now }) =>
        scope === 'ALL' ? (await payouts.overviewCount(now)).batchesAwaitingPayment : 0,
      needsYou: {
        tone: 'attention',
        title: 'Payouts to confirm',
        line: (n) =>
          `${n} ${n === 1 ? 'batch was' : 'batches were'} sent to the bank and ${n === 1 ? 'is' : 'are'} waiting for the UTRs.`,
        action: 'Mark as paid',
      },
    },
  ];
}
