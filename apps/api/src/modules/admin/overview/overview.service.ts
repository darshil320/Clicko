import { createHash } from 'node:crypto';
import { type AdminAlert, AdminOverview } from '@clickco/contracts';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { CLOCK, type Clock } from '../../../common/clock';
import { ENV, type Env } from '../../../config/env';
import { REDIS } from '../../../infra/queues/redis';
import { DESK_ROLES, scopeFor } from '../access/roles';
import type { StaffCaller } from '../access/staff-context';
import { AlertFeedService } from '../desks/alert-feed.service';
import { assembleOverview, type CountedSource } from './overview.assemble';
import { OverviewRegistry } from './overview.registry';

/** How many of the newest alerts Today lists under the cards. */
export const LATEST_ALERTS = 5;

/**
 * Performance audit (ADR-0027 D6): the answer is cached per staff scope for this long. Every
 * caller with the same grants sees the same numbers, so a floor of agents polling Today costs one
 * set of counts per scope per 20 s instead of one per agent per poll.
 */
export const OVERVIEW_CACHE_TTL_MS = 20_000;

/** Same grants (role + city, order-free) → same key. Grants decide every source's scope. */
export function overviewScopeKey(grants: StaffCaller['grants']): string {
  const canonical = grants
    .map((g) => `${g.role}|${g.cityId ?? '*'}`)
    .sort()
    .join(',');
  return createHash('sha256').update(canonical).digest('hex');
}

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
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Served from the per-scope cache when fresh; an incomplete answer is never cached. */
  async overview(caller: StaffCaller): Promise<AdminOverview> {
    const key = `${this.env.QUEUE_PREFIX}:admin-overview:${overviewScopeKey(caller.grants)}`;
    const cached = await this.readCache(key);
    if (cached) return cached;
    const fresh = await this.compute(caller);
    if (!fresh.incomplete) await this.writeCache(key, fresh);
    return fresh;
  }

  private async readCache(key: string): Promise<AdminOverview | null> {
    try {
      const raw = await this.redis.get(key);
      if (raw === null) return null;
      const parsed = AdminOverview.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : null;
    } catch (error) {
      this.logger.warn(`Overview cache read failed: ${errorText(error)}`);
      return null;
    }
  }

  private async writeCache(key: string, value: AdminOverview): Promise<void> {
    try {
      await this.redis.set(key, JSON.stringify(value), 'PX', OVERVIEW_CACHE_TTL_MS);
    } catch (error) {
      this.logger.warn(`Overview cache write failed: ${errorText(error)}`);
    }
  }

  private async compute(caller: StaffCaller): Promise<AdminOverview> {
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

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
