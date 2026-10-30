'use client';

import type { PricingRulesetSummary } from '@clickco/contracts';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  CalendarDaysIcon,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  PageHeader,
  PlusIcon,
  RelativeTime,
  Skeleton,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TagIcon,
} from '@clickco/ui-web';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { adminApi } from '../../shared/api';
import { describeError } from '../../shared/errors';
import { formatDateTime } from '../../shared/format';
import { useAdminMutation } from '../../shared/mutation';
import { pricingKeys, useCanEditPricing, usePricingOverview } from './use-pricing';

const STATE_LABEL: Readonly<Record<PricingRulesetSummary['state'], string>> = {
  LIVE: 'Live',
  SCHEDULED: 'Scheduled',
  DRAFT: 'Draft',
  CLOSED: 'Replaced',
  DISCARDED: 'Discarded',
};

const draftName = (r: PricingRulesetSummary) => r.label ?? 'Untitled draft';

/**
 * Pricing home (ADR-0026 D4/D8): what is live and since when, a change waiting to go live, the
 * drafts in progress and every past version. One primary action: start a draft.
 */
export function PricingHome() {
  const overview = usePricingOverview();
  const canEdit = useCanEditPricing();
  const router = useRouter();
  const create = useAdminMutation({
    run: (_: null, idem) => adminApi.pricing.createDraft({}, idem),
    success: () => 'Draft started — a copy of the live rate card',
    invalidate: [pricingKeys.all],
    onSuccess: (draft) => router.push(`/pricing/${draft.summary.id}`),
  });
  const cancel = useAdminMutation({
    run: (id: string, idem) => adminApi.pricing.cancelSchedule(id, idem),
    success: () => 'Scheduled change cancelled — it is a draft again',
    invalidate: [pricingKeys.all],
  });

  const data = overview.data;
  return (
    <>
      <PageHeader
        title="Pricing"
        description="The rate card every new quote uses. Change it in a draft, check it in the calculator, then publish."
        actions={
          canEdit ? (
            <Button onClick={() => create.mutate(null)} disabled={create.isPending}>
              {create.isPending ? <Spinner /> : <PlusIcon />}
              New draft
            </Button>
          ) : null
        }
      />
      {overview.isLoading ? <Skeleton className="h-32 w-full" /> : null}
      {overview.error ? (
        <Alert variant="destructive">
          <AlertTitle>Pricing could not load</AlertTitle>
          <AlertDescription>{describeError(overview.error).message}</AlertDescription>
        </Alert>
      ) : null}
      {data ? (
        <div className="grid gap-6">
          <LiveCard live={data.live} />
          {data.scheduled ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CalendarDaysIcon className="size-4" />
                  Version {data.scheduled.version} goes live{' '}
                  {formatDateTime(data.scheduled.effectiveFrom ?? data.scheduled.createdAt)}
                </CardTitle>
                <CardDescription>
                  <RelativeTime at={data.scheduled.effectiveFrom ?? data.scheduled.createdAt} /> ·
                  published by {data.scheduled.publishedBy ?? 'finance'}. Until then, quotes use the
                  live version.
                </CardDescription>
                <CardAction className="flex gap-2">
                  <Button variant="outline" asChild>
                    <Link href={`/pricing/${data.scheduled.id}`}>View rates</Link>
                  </Button>
                  {canEdit ? (
                    <Button
                      variant="outline"
                      disabled={cancel.isPending}
                      onClick={() => data.scheduled && cancel.mutate(data.scheduled.id)}
                    >
                      Cancel change
                    </Button>
                  ) : null}
                </CardAction>
              </CardHeader>
            </Card>
          ) : null}
          <section className="grid gap-3" aria-labelledby="drafts-title">
            <h2 id="drafts-title" className="font-semibold text-lg">
              Drafts
            </h2>
            {data.drafts.length === 0 ? (
              <Card>
                <EmptyState
                  icon={<TagIcon />}
                  title="No drafts"
                  description={
                    canEdit
                      ? 'Start a draft to change prices. Nothing changes for customers until you publish.'
                      : 'Finance starts drafts here when prices change.'
                  }
                />
              </Card>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {data.drafts.map((d) => (
                  <Card key={d.id}>
                    <CardHeader>
                      <CardTitle>{draftName(d)}</CardTitle>
                      <CardDescription>
                        From version {d.basedOn?.version ?? '—'} · edited{' '}
                        <RelativeTime at={d.updatedAt} />
                        {d.createdBy ? ` · started by ${d.createdBy}` : ''}
                      </CardDescription>
                      <CardAction>
                        <Badge variant={d.changeCount ? 'warning' : 'neutral'}>
                          {d.changeCount === 1 ? '1 change' : `${d.changeCount ?? 0} changes`}
                        </Badge>
                      </CardAction>
                    </CardHeader>
                    <CardContent>
                      <Button variant="outline" asChild>
                        <Link href={`/pricing/${d.id}`}>
                          {canEdit ? 'Open draft' : 'View draft'}
                        </Link>
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </section>
          <History rows={data.history} />
        </div>
      ) : null}
    </>
  );
}

function LiveCard({ live }: { readonly live: PricingRulesetSummary | null }) {
  if (!live) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Nothing is live</AlertTitle>
        <AlertDescription>
          New quotes cannot be priced until a version is published.
        </AlertDescription>
      </Alert>
    );
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <Badge variant="success">Live</Badge>
          Version {live.version}
          {live.label ? <span className="text-muted-foreground">· {live.label}</span> : null}
        </CardTitle>
        <CardDescription>
          Since {formatDateTime(live.effectiveFrom ?? live.createdAt)} (
          <RelativeTime at={live.effectiveFrom ?? live.createdAt} />)
          {live.publishedBy ? ` · published by ${live.publishedBy}` : ''}
          {live.effectiveTo ? ` · replaced ${formatDateTime(live.effectiveTo)}` : ''}
        </CardDescription>
        <CardAction>
          <Button variant="outline" asChild>
            <Link href={`/pricing/${live.id}`}>View rates</Link>
          </Button>
        </CardAction>
      </CardHeader>
    </Card>
  );
}

function History({ rows }: { readonly rows: readonly PricingRulesetSummary[] }) {
  if (rows.length === 0) return null;
  return (
    <section className="grid gap-3" aria-labelledby="history-title">
      <h2 id="history-title" className="font-semibold text-lg">
        Earlier versions
      </h2>
      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Version</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Live from</TableHead>
              <TableHead>Until</TableHead>
              <TableHead>By</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell>
                  <Link
                    className="font-semibold underline-offset-4 hover:underline"
                    href={`/pricing/${r.id}`}
                  >
                    {r.version ?? draftName(r)}
                  </Link>
                </TableCell>
                <TableCell>
                  <Badge variant="neutral">{STATE_LABEL[r.state]}</Badge>
                </TableCell>
                <TableCell>{r.effectiveFrom ? formatDateTime(r.effectiveFrom) : '—'}</TableCell>
                <TableCell>
                  {r.effectiveTo
                    ? formatDateTime(r.effectiveTo)
                    : r.discardedAt
                      ? `Discarded ${formatDateTime(r.discardedAt)}`
                      : '—'}
                </TableCell>
                <TableCell>{r.publishedBy ?? r.discardedBy ?? r.createdBy ?? '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </section>
  );
}
