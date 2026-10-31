import type { BookingStatus } from '@clickco/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { BookingsService } from '../../bookings/bookings.service';
import { IncidentsService } from '../../onsite/incidents.service';
import { OpsAlertsReader } from '../../ops/ops-alerts.reader';
import { SlaDeskService } from '../../sla/sla-desk.service';
import type { CityScope } from '../access/roles';
import { OverviewRegistry } from './overview.registry';
import { isAre, plural } from './overview-source';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
/** IST is UTC+5:30 all year (no daylight saving). */
const IST_OFFSET_MS = 5.5 * HOUR_MS;
/** Alerts and late deliveries are read as a page; past this they show as "100+". */
export const OVERVIEW_PAGE_CAP = 100;

/** A shoot on today's schedule: paid for and not called off. */
const ON_SCHEDULE: readonly BookingStatus[] = [
  'CONFIRMED',
  'DISPATCHING',
  'ASSIGNED',
  'EN_ROUTE',
  'CHECKED_IN',
  'IN_PROGRESS',
  'CHECKED_OUT',
  'UPLOADING',
  'PROCESSING',
  'QA',
  'BALANCE_PENDING',
  'DELIVERED',
  'CLOSED',
  'QUALITY_ESCALATION',
  'DATA_LOSS',
];
const ON_SITE: readonly BookingStatus[] = ['CHECKED_IN', 'IN_PROGRESS'];

/** The IST calendar day `now` falls on, as [start, end) instants. */
export function istDay(now: Date): { readonly start: Date; readonly end: Date } {
  const start = Math.floor((now.getTime() + IST_OFFSET_MS) / DAY_MS) * DAY_MS - IST_OFFSET_MS;
  return { start: new Date(start), end: new Date(start + DAY_MS) };
}

/**
 * The Sprint 9 desks' counts for "Today" (ADR-0026 D8), registered once at start-up. Every count
 * is made by the module that owns the rows; this module only passes the caller's city scope.
 */
@Injectable()
export class OpsOverviewSources {
  constructor(
    @Inject(OverviewRegistry) registry: OverviewRegistry,
    @Inject(BookingsService) private readonly bookings: BookingsService,
    @Inject(SlaDeskService) private readonly sla: SlaDeskService,
    @Inject(IncidentsService) private readonly incidents: IncidentsService,
    @Inject(OpsAlertsReader) private readonly alerts: OpsAlertsReader,
  ) {
    registry.register({
      key: 'bookings.today',
      desk: 'bookings',
      count: ({ scope, now }) =>
        this.bookings.adminCount({ scope, statuses: ON_SCHEDULE, ...this.today(now) }),
      tile: { label: 'Shoots today', hint: 'On today’s schedule (IST), not cancelled', order: 10 },
    });
    registry.register({
      key: 'bookings.on_site',
      desk: 'bookings',
      count: ({ scope }) => this.bookings.adminCount({ scope, statuses: ON_SITE }),
      tile: { label: 'In progress now', hint: 'Photographers checked in and shooting', order: 20 },
    });
    registry.register({
      key: 'bookings.delivery_due',
      desk: 'bookings',
      count: ({ scope, now }) =>
        this.sla.deliveriesDueCount(
          this.bookings.idsInScope(scope),
          new Date(now.getTime() + DAY_MS),
        ),
      tile: {
        label: 'Deliveries due',
        hint: 'Photos promised to clients in the next 24 hours',
        order: 30,
      },
    });
    registry.register({
      key: 'qa.waiting',
      desk: 'qa',
      count: ({ scope }) => this.bookings.adminCount({ scope, statuses: ['QA'] }),
      tile: {
        label: 'Waiting for QA',
        hint: 'Uploaded shoots waiting for a quality check',
        order: 40,
      },
      needsYou: {
        tone: 'attention',
        title: 'Waiting for QA',
        line: (n) => `${plural(n, 'shoot')} ${isAre(n)} waiting for a quality check.`,
        action: 'Start checking',
      },
    });
    registry.register({
      key: 'incidents.to_confirm',
      desk: 'incidents',
      count: ({ scope }) => this.openIncidents(scope),
      tile: { label: 'Incidents', hint: 'Reports from the field not yet confirmed', order: 50 },
      needsYou: {
        tone: 'urgent',
        title: 'Incidents to confirm',
        line: (n) => `${plural(n, 'report')} from the field ${isAre(n)} waiting for your decision.`,
        action: 'Review reports',
      },
    });
    registry.register({
      key: 'dispatch.unfilled',
      desk: 'dispatch',
      count: ({ scope }) => this.bookings.adminCount({ scope, statuses: ['DISPATCHING'] }),
      tile: {
        label: 'Still unfilled',
        hint: 'Bookings still looking for a photographer',
        order: 60,
      },
      needsYou: {
        tone: 'attention',
        title: 'Still looking for a photographer',
        line: (n) => `${plural(n, 'booking')} ${isAre(n)} still being offered to photographers.`,
        action: 'Open dispatch',
      },
    });
    registry.register({
      key: 'breaches.open',
      desk: 'breaches',
      cap: OVERVIEW_PAGE_CAP,
      count: ({ scope }) => this.openBreaches(scope),
      needsYou: {
        tone: 'attention',
        title: 'Late deliveries',
        line: (n) => `${plural(n, 'late delivery', 'late deliveries')} to attribute or waive.`,
        action: 'Review late deliveries',
      },
    });
    registry.register({
      key: 'alerts.last_day',
      desk: 'alerts',
      cap: OVERVIEW_PAGE_CAP,
      count: ({ scope, now }) => this.recentAlerts(scope, now),
      tile: {
        label: 'Alerts, 24 h',
        hint: 'Ops alerts and review flags since this time yesterday',
        order: 70,
      },
      needsYou: {
        tone: 'attention',
        title: 'New alerts',
        line: (n) => `${plural(n, 'alert')} in the last 24 hours.`,
        action: 'See alerts',
      },
    });
  }

  private today(now: Date) {
    const day = istDay(now);
    return { startsFrom: day.start, startsBefore: day.end };
  }

  /** What the incident desk lists: on-site reports and client-absent reports not yet decided. */
  private openIncidents(scope: CityScope): Promise<number> {
    return this.incidents.countOpenReports(
      this.bookings.idsInScope(scope, ['CHECKED_IN', 'IN_PROGRESS']),
      this.bookings.idsInScope(scope, ['CHECKED_OUT']),
    );
  }

  private async openBreaches(scope: CityScope): Promise<number> {
    const rows = await this.sla.breachPage({
      status: 'OPEN',
      bookings: scope === 'ALL' ? null : this.bookings.idsInScope(scope),
      limit: OVERVIEW_PAGE_CAP,
    });
    return rows.length;
  }

  /** As the alert feed shows them: city-scoped callers see their bookings' alerts only. */
  private async recentAlerts(scope: CityScope, now: Date): Promise<number> {
    const rows = await this.alerts.page({
      bookings: scope === 'ALL' ? null : this.bookings.idsInScope(scope),
      since: new Date(now.getTime() - DAY_MS),
      limit: OVERVIEW_PAGE_CAP,
    });
    return rows.length;
  }
}
