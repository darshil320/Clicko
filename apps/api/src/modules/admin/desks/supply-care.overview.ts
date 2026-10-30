import { Inject, Injectable } from '@nestjs/common';
import { OverviewRegistry } from '../overview/overview.registry';
import { isAre, plural } from '../overview/overview-source';
import { ClaimDeskService } from './claim-desk.service';
import { QualityIssuesDeskService } from './quality-issues-desk.service';
import { SupplyDeskService } from './supply-desk.service';
import { TicketDeskService } from './ticket-desk.service';

/**
 * Stream C's counts for "Today" (ADR-0026 D8). Not wired by default: add this class to the
 * AdminModule providers to register them (one "Needs you" source per desk).
 */
@Injectable()
export class SupplyCareOverviewSources {
  constructor(
    @Inject(OverviewRegistry) registry: OverviewRegistry,
    @Inject(SupplyDeskService) supply: SupplyDeskService,
    @Inject(QualityIssuesDeskService) quality: QualityIssuesDeskService,
    @Inject(TicketDeskService) tickets: TicketDeskService,
    @Inject(ClaimDeskService) claims: ClaimDeskService,
  ) {
    registry.register({
      key: 'photographers.kyc_pending',
      desk: 'photographers',
      count: ({ scope }) => supply.overviewKycPending(scope),
      needsYou: {
        tone: 'attention',
        title: 'Documents to check',
        line: (n) => `${plural(n, 'KYC document')} ${isAre(n)} waiting for a decision.`,
        action: 'Check documents',
      },
    });
    registry.register({
      key: 'quality.open',
      desk: 'quality',
      count: ({ scope }) => quality.overviewOpen(scope),
      needsYou: {
        tone: 'attention',
        title: 'Quality issues',
        line: (n) =>
          `${plural(n, 'client complaint')} ${isAre(n)} waiting for the Quality Manager.`,
        action: 'Review issues',
      },
    });
    registry.register({
      key: 'tickets.due',
      desk: 'tickets',
      count: async ({ scope }) => {
        const due = await tickets.overviewDue(scope);
        return due.dueSoon + due.overdue;
      },
      tile: {
        label: 'Tickets due',
        hint: 'Replies due soon or overdue (48 h / 30 days)',
        order: 55,
      },
      needsYou: {
        tone: 'urgent',
        title: 'Tickets due',
        line: (n) => `${plural(n, 'ticket')} ${isAre(n)} close to or past the legal deadline.`,
        action: 'Open tickets',
      },
    });
    registry.register({
      key: 'claims.pending',
      desk: 'claims',
      count: ({ scope }) => claims.overviewPending(scope),
      needsYou: {
        tone: 'attention',
        title: 'Equipment claims',
        line: (n) => `${plural(n, 'claim')} ${isAre(n)} waiting for a decision.`,
        action: 'Review claims',
      },
    });
  }
}
