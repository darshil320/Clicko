import type { AdminAlert, AdminOverview } from '@clickco/contracts';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { CLOCK, type Clock } from '../../../common/clock';
import { DESK_ROLES, scopeFor } from '../access/roles';
import type { StaffCaller } from '../access/staff-context';
import { AlertFeedService } from '../desks/alert-feed.service';
import { assembleOverview, type CountedSource } from './overview.assemble';
import { OverviewRegistry } from './overview.registry';

/** How many of the newest alerts Today lists under the cards. */
export const LATEST_ALERTS = 5;

/**
 * `GET /admin/overview` (ADR-0026 D8): asks every registered source whose desk the caller can
 * open, in that desk's cities, all at once. A source that fails is logged and left out (the
 * answer says `incomplete`), so one broken count never blanks the page.
 */
@Injectable()
export class OverviewService {
  private readonly logger = new Logger(OverviewService.name);

  constructor(
    @Inject(OverviewRegistry) private readonly registry: OverviewRegistry,
    @Inject(AlertFeedService) private readonly alertFeed: AlertFeedService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async overview(caller: StaffCaller): Promise<AdminOverview> {
    const now = this.clock();
    const open = this.registry.sources().flatMap((source) => {
      const scope = scopeFor(caller.grants, DESK_ROLES[source.desk]);
      return scope === null ? [] : [{ source, scope }];
    });
    const [counted, alerts] = await Promise.all([
      Promise.all(
        open.map(async ({ source, scope }): Promise<CountedSource> => {
          try {
            return { source, value: await source.count({ caller, scope, now }) };
          } catch (error) {
            this.logger.error(
              `Overview source ${source.key} failed: ${error instanceof Error ? error.message : String(error)}`,
            );
            return { source, value: null };
          }
        }),
      ),
      this.latestAlerts(caller),
    ]);
    return assembleOverview(counted, alerts, now);
  }

  /** The alert feed's first page for this caller; [] when the alerts desk is closed to them. */
  private async latestAlerts(caller: StaffCaller): Promise<AdminAlert[] | null> {
    const scope = scopeFor(caller.grants, DESK_ROLES.alerts);
    if (scope === null) return [];
    try {
      const page = await this.alertFeed.list({ ...caller, scope }, { limit: LATEST_ALERTS });
      return page.items;
    } catch (error) {
      this.logger.error(
        `Overview latest alerts failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }
}
