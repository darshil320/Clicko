import { Inject, Injectable } from '@nestjs/common';
import { payoutsOverviewSources } from '../../payouts/admin/payouts-overview.sources';
import { PayoutsService } from '../../payouts/payouts.service';
import { OverviewRegistry } from './overview.registry';

/** Registers stream B's payouts counts with Today (ADR-0026 D8), once. */
@Injectable()
export class PayoutsOverviewSources {
  constructor(
    @Inject(OverviewRegistry) registry: OverviewRegistry,
    @Inject(PayoutsService) payouts: PayoutsService,
  ) {
    for (const source of payoutsOverviewSources(payouts)) registry.register(source);
  }
}
