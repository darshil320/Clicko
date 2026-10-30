import { Injectable } from '@nestjs/common';
import type { OverviewSource } from './overview-source';

/**
 * ═══ REGISTRATION POINT for Today's counts (ADR-0026 D8/D9) ═══
 *
 * Every number on "Today", every "Needs you" card and every live count in the navigation comes
 * from a source registered here. A Sprint 10 desk adds its count with one call, from any
 * provider of the AdminModule (its desk service's constructor is the natural place):
 *
 *   constructor(@Inject(OverviewRegistry) overview: OverviewRegistry, …) {
 *     overview.register({
 *       key: 'refunds.awaiting_approval',
 *       desk: 'refunds',
 *       count: (ctx) => this.refunds.awaitingApprovalCount(ctx.scope),
 *       needsYou: {
 *         tone: 'attention',
 *         title: 'Refunds to approve',
 *         line: (n) => `${plural(n, 'refund')} ${isAre(n)} waiting for a second pair of eyes.`,
 *         action: 'Review refunds',
 *       },
 *     });
 *   }
 *
 * `ctx.scope` is already the caller's cities for that desk; a desk the caller cannot open is
 * never counted. Count in SQL in the module that owns the rows. The panel needs no change.
 * The Sprint 9 sources are in `ops-sources.ts`.
 */
@Injectable()
export class OverviewRegistry {
  private entries: readonly OverviewSource[] = [];

  register(source: OverviewSource): void {
    if (this.entries.some((s) => s.key === source.key)) {
      throw new Error(`Overview source "${source.key}" is registered twice`);
    }
    if (source.needsYou && this.entries.some((s) => s.needsYou && s.desk === source.desk)) {
      throw new Error(`Desk "${source.desk}" already has a "Needs you" source (one per desk)`);
    }
    if (!source.tile && !source.needsYou) {
      throw new Error(`Overview source "${source.key}" shows nowhere: give it a tile or needsYou`);
    }
    this.entries = [...this.entries, source];
  }

  sources(): readonly OverviewSource[] {
    return this.entries;
  }
}
