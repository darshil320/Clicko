'use client';

import type { AdminAlert, AdminNeedsYou, AdminOverviewTile } from '@clickco/contracts';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  ArrowRightIcon,
  BellIcon,
  Button,
  Card,
  CheckCheckIcon,
  CloudOffIcon,
  CountBadge,
  EmptyState,
  formatIstWeekdayDate,
  PageHeader,
  RefreshCwIcon,
  RelativeTime,
  SectionHeader,
  Skeleton,
  StatCard,
  StatGrid,
} from '@clickco/ui-web';
import Link from 'next/link';
import { canUse, hrefOf } from '../../shared/access';
import { BookingLink } from '../../shared/cells';
import { DESK_ICONS } from '../../shared/desk-icons';
import { describeError } from '../../shared/errors';
import { greeting } from '../../shared/greeting';
import { useOverview } from '../../shared/overview';
import { useSession } from '../../shared/session';
import { useNow } from '../../shared/use-now';

const SKELETON_TILES = 4;

/** "1,204" / "100+" */
const shown = (value: number, capped: boolean): string =>
  `${value.toLocaleString('en-IN')}${capped ? '+' : ''}`;

function NumberRow({ tiles }: { readonly tiles: ReadonlyArray<AdminOverviewTile> }) {
  return (
    <StatGrid aria-label="Today in numbers">
      {tiles.map((tile) => {
        const Icon = DESK_ICONS[tile.desk];
        return (
          <StatCard
            key={tile.key}
            asChild
            label={tile.label}
            value={shown(tile.value, tile.capped)}
            hint={tile.hint}
            tone={tile.tone}
            icon={<Icon />}
          >
            <Link
              href={hrefOf(tile.desk)}
              aria-label={`${tile.label}: ${shown(tile.value, tile.capped)}. ${tile.hint}`}
            />
          </StatCard>
        );
      })}
    </StatGrid>
  );
}

/** One card per desk with work: what is waiting, in one line, and the one button to go there. */
function NeedsYouCard({ item }: { readonly item: AdminNeedsYou }) {
  const Icon = DESK_ICONS[item.desk];
  return (
    <Card className="gap-3 px-5 py-4">
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground [&_svg]:size-4"
        >
          <Icon />
        </span>
        <div className="grid min-w-0 flex-1 gap-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate font-semibold text-base">{item.title}</h3>
            <CountBadge
              count={item.count}
              capped={item.capped}
              tone={item.tone}
              label={item.tone === 'urgent' ? 'urgent' : 'waiting'}
            />
          </div>
          <p className="text-muted-foreground text-sm">{item.line}</p>
        </div>
      </div>
      <div className="flex justify-end">
        <Button asChild variant="outline" size="sm">
          <Link href={hrefOf(item.desk)}>
            {item.action}
            <ArrowRightIcon aria-hidden="true" />
          </Link>
        </Button>
      </div>
    </Card>
  );
}

function NeedsYou({ items }: { readonly items: ReadonlyArray<AdminNeedsYou> }) {
  return (
    <section aria-labelledby="needs-you" className="grid gap-1">
      <SectionHeader
        id="needs-you"
        title="Needs you"
        description="Work waiting on your desks, most urgent first."
      />
      {items.length === 0 ? (
        <Card>
          <EmptyState
            tone="success"
            icon={<CheckCheckIcon />}
            title="All caught up"
            description="Nothing is waiting on your desks right now. New work shows up here as it arrives."
          />
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => (
            <NeedsYouCard key={item.desk} item={item} />
          ))}
        </div>
      )}
    </section>
  );
}

function LatestAlerts({
  alerts,
  now,
}: {
  readonly alerts: ReadonlyArray<AdminAlert>;
  readonly now: number;
}) {
  return (
    <section aria-labelledby="latest-alerts" className="grid gap-1">
      <SectionHeader
        id="latest-alerts"
        title="Latest alerts"
        action={
          <Button asChild variant="ghost" size="sm">
            <Link href={hrefOf('alerts')}>
              See all
              <ArrowRightIcon aria-hidden="true" />
            </Link>
          </Button>
        }
      />
      <Card className="py-0">
        {alerts.length === 0 ? (
          <EmptyState
            size="compact"
            icon={<BellIcon />}
            title="No alerts"
            description="Ops alerts and review flags in your cities appear here."
          />
        ) : (
          <ul className="divide-y">
            {alerts.map((a) => (
              <li key={a.eventId} className="flex flex-wrap items-start gap-x-4 gap-y-1 px-5 py-3">
                <p className="min-w-0 flex-1 text-sm">{a.summary}</p>
                <div className="flex shrink-0 items-center gap-3 text-sm">
                  {a.bookingId && a.bookingReference ? (
                    <BookingLink id={a.bookingId} reference={a.bookingReference} />
                  ) : null}
                  <RelativeTime at={a.occurredAt} now={now} className="text-muted-foreground" />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}

function Loading() {
  return (
    <div className="grid gap-8" role="status" aria-busy="true" aria-label="Loading today">
      <StatGrid>
        {Array.from({ length: SKELETON_TILES }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: placeholders have no identity
          <Skeleton key={i} className="h-32 rounded-lg" />
        ))}
      </StatGrid>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Skeleton className="h-36 rounded-lg" />
        <Skeleton className="h-36 rounded-lg" />
      </div>
    </div>
  );
}

/**
 * "Today", the panel's home (ADR-0026 D8): a greeting, the live numbers, one "Needs you" card per
 * desk with work, and the latest alerts. Refreshes every minute while the tab is visible; what
 * the caller sees is scoped to their roles and cities by the server.
 */
export function Today() {
  const session = useSession();
  const now = useNow();
  const grants = session?.staff.grants ?? null;
  const overview = useOverview(grants);
  const data = overview.data;
  const showAlerts = grants !== null && canUse(grants, 'alerts');

  return (
    <div className="grid gap-8">
      <PageHeader
        className="mb-0"
        eyebrow={formatIstWeekdayDate(now)}
        title={greeting(now, session?.staff.fullName ?? '')}
        description={
          data
            ? data.needsYou.length === 0
              ? 'Everything on your desks is handled. Here is how the day looks.'
              : 'Here is what needs you today.'
            : 'Here is how the day looks.'
        }
        actions={
          <>
            {data ? (
              <span className="text-muted-foreground text-sm">
                Updated <RelativeTime at={data.generatedAt} now={now} />
              </span>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              onClick={() => void overview.refetch()}
              disabled={overview.isFetching}
            >
              <RefreshCwIcon />
              Refresh
            </Button>
          </>
        }
      />
      {overview.isError && !data ? (
        <Alert variant="destructive">
          <CloudOffIcon />
          <AlertTitle>Today could not load</AlertTitle>
          <AlertDescription>
            <p>{describeError(overview.error).message}</p>
            <Button variant="outline" size="sm" onClick={() => void overview.refetch()}>
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {!data && !overview.isError ? <Loading /> : null}
      {data ? (
        <>
          {data.incomplete ? (
            <Alert variant="info">
              <CloudOffIcon />
              <AlertDescription>
                <p>Some numbers could not load just now. They refresh within a minute.</p>
              </AlertDescription>
            </Alert>
          ) : null}
          {data.tiles.length > 0 ? <NumberRow tiles={data.tiles} /> : null}
          <NeedsYou items={data.needsYou} />
          {showAlerts ? <LatestAlerts alerts={data.latestAlerts} now={now} /> : null}
        </>
      ) : null}
    </div>
  );
}
