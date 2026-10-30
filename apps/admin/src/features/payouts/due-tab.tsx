'use client';

import type { AdminPayoutDuePayee } from '@clickco/contracts';
import {
  Badge,
  Button,
  CircleCheckIcon,
  type ColumnDef,
  DataTable,
  EmptyState,
  RelativeTime,
  SectionHeader,
  SideSheet,
  StatCard,
  StatGrid,
  WalletIcon,
} from '@clickco/ui-web';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { adminApi } from '../../shared/api';
import { BookingLink, Muted } from '../../shared/cells';
import { describeError } from '../../shared/errors';
import { formatDay } from '../../shared/format';
import { useAdminMutation } from '../../shared/mutation';
import { useNow } from '../../shared/use-now';
import { BLOCKER, count, maskedAccount, NOTICE, rupees, toPhotographers } from './labels';
import { Confirm, payoutKeys } from './shared';

function columns(now: number): ReadonlyArray<ColumnDef<AdminPayoutDuePayee>> {
  return [
    {
      id: 'name',
      header: 'Photographer',
      accessorFn: (p) => p.name,
      cell: ({ row }) => (
        <div className="grid">
          <span className="font-semibold">{row.original.name}</span>
          <Muted>{row.original.cityName ?? '—'}</Muted>
        </div>
      ),
    },
    {
      id: 'jobs',
      header: 'Jobs',
      accessorFn: (p) => p.payoutCount,
      cell: ({ row }) => (
        <div className="grid">
          <span>{count(row.original.payoutCount, 'job')}</span>
          <Muted>
            due <RelativeTime at={row.original.lines[0]?.eligibleAt ?? now} now={now} />
          </Muted>
        </div>
      ),
    },
    {
      id: 'earned',
      header: 'Earned',
      accessorFn: (p) => p.grossPaise,
      cell: ({ row }) => <span className="font-semibold">{rupees(row.original.grossPaise)}</span>,
    },
    {
      id: 'bank',
      header: 'Bank',
      enableSorting: false,
      cell: ({ row }) => {
        const p = row.original;
        if (p.blockers.length > 0) {
          return <Badge variant="destructive">{BLOCKER[p.blockers[0] ?? 'NO_BANK_ACCOUNT']}</Badge>;
        }
        return p.bank ? (
          <div className="grid">
            <span>{maskedAccount(p.bank)}</span>
            <Muted>{p.bank.ifsc}</Muted>
          </div>
        ) : null;
      },
    },
    {
      id: 'notes',
      header: 'Notes',
      enableSorting: false,
      cell: ({ row }) =>
        row.original.notices.length === 0 ? (
          <Muted>—</Muted>
        ) : (
          <div className="flex flex-wrap gap-1">
            {row.original.notices.map((n) => (
              <Badge key={n} variant="warning">
                {NOTICE[n]}
              </Badge>
            ))}
          </div>
        ),
    },
  ];
}

/**
 * "Due": what the next batch would pay, who is waiting on bank details, what is coming up. One
 * primary action: make the batch (or open the draft that exists).
 */
export function DueTab({ onOpenBatch }: { readonly onOpenBatch: (id: string) => void }) {
  const now = useNow();
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [open, setOpen] = useState<AdminPayoutDuePayee | null>(null);
  const due = useQuery({ queryKey: payoutKeys.due, queryFn: () => adminApi.payouts.due() });
  const cols = useMemo(() => columns(now), [now]);

  const create = useAdminMutation({
    run: (vars: { kind: 'WEEKLY' | 'OFF_CYCLE' }, idem) =>
      adminApi.payouts.batches.create(vars, idem),
    success: (_, batch) => `Batch ${batch.reference} is ready to review`,
    invalidate: [payoutKeys.all],
    onSuccess: (batch) => {
      setConfirming(false);
      router.push(`/payouts/batches/${batch.id}`);
    },
  });

  const d = due.data;
  const weekly = d?.nextBatchKind === 'WEEKLY';
  const primary = d?.draft ? (
    <Button onClick={() => d.draft && onOpenBatch(d.draft.id)}>
      Review draft {d.draft.reference}
    </Button>
  ) : (
    <Button disabled={!d || d.ready.payoutCount === 0} onClick={() => setConfirming(true)}>
      <WalletIcon />
      {weekly ? "Make this week's batch" : 'Make an off-cycle batch'}
    </Button>
  );

  return (
    <div className="grid gap-8">
      <StatGrid>
        <StatCard
          label="Ready to pay"
          value={d ? rupees(d.ready.grossPaise) : '—'}
          hint={
            d
              ? `${count(d.ready.payeeCount, 'photographer')} · ${count(d.ready.payoutCount, 'job')}`
              : null
          }
          tone={d && d.ready.payoutCount > 0 ? 'attention' : 'neutral'}
        />
        <StatCard
          label="Waiting on bank details"
          value={d ? count(d.blocked.payeeCount, 'photographer') : '—'}
          hint={
            d && d.blocked.payoutCount > 0
              ? `${rupees(d.blocked.grossPaise)} held back`
              : 'Nobody held back'
          }
          tone={d && d.blocked.payeeCount > 0 ? 'urgent' : 'neutral'}
        />
        <StatCard
          label="Coming up, next 7 days"
          value={d ? rupees(d.upcoming.grossPaise) : '—'}
          hint={d ? count(d.upcoming.payoutCount, 'job') : null}
        />
        <StatCard
          label="Next weekly run"
          value={d ? formatDay(d.nextWeeklyRunOn) : '—'}
          hint="Every Monday · TDS and deductions are worked out in the batch"
        />
      </StatGrid>

      <section className="grid gap-4">
        <SectionHeader
          title="Due now"
          description="Delivered at least 3 days ago and not yet in a batch. Amounts before TDS and deductions."
          action={primary}
        />
        {due.isSuccess && d && d.payees.length === 0 ? (
          <EmptyState
            tone="success"
            icon={<CircleCheckIcon />}
            title="All caught up"
            description={
              d.upcoming.payoutCount > 0
                ? `Nothing is due yet. ${toPhotographers(d.upcoming.grossPaise, d.upcoming.payeeCount)} falls due in the next 7 days.`
                : 'Nothing is due. New payouts appear 3 days after each delivery.'
            }
          />
        ) : (
          <DataTable
            caption="Photographers with payouts due"
            columns={cols}
            data={d?.payees ?? []}
            getRowId={(p) => p.photographerId}
            isLoading={due.isPending}
            error={due.isError ? describeError(due.error).message : null}
            onRetry={() => void due.refetch()}
            onRowClick={setOpen}
            rowLabel={(p) => `Jobs for ${p.name}`}
          />
        )}
        {d?.truncated ? (
          <p className="text-muted-foreground text-sm">
            Showing the first {d.payees.length} photographers; the totals count everyone.
          </p>
        ) : null}
      </section>

      {confirming && d ? (
        <Confirm
          title={weekly ? "Make this week's batch?" : 'Make an off-cycle batch?'}
          description={
            <>
              {toPhotographers(d.ready.grossPaise, d.ready.payeeCount)} before TDS and deductions (
              {count(d.ready.payoutCount, 'job')}). You review the exact amounts next; nothing is
              paid until you export the bank file.
              {d.blocked.payeeCount > 0
                ? ` ${count(d.blocked.payeeCount, 'photographer')} waiting on bank details stay${d.blocked.payeeCount === 1 ? 's' : ''} in Due.`
                : ''}
            </>
          }
          confirmLabel="Make batch"
          pending={create.isPending}
          onConfirm={() => create.mutate({ kind: d.nextBatchKind })}
          onClose={() => setConfirming(false)}
        />
      ) : null}

      <SideSheet
        open={open !== null}
        onOpenChange={(o) => (o ? undefined : setOpen(null))}
        title={open?.name ?? ''}
        description={
          open ? `${count(open.payoutCount, 'job')} · ${rupees(open.grossPaise)} earned` : undefined
        }
      >
        <ul className="grid gap-3">
          {open?.lines.map((l) => (
            <li key={l.payoutId} className="flex items-start justify-between gap-4 border-b pb-3">
              <div className="grid">
                <BookingLink id={l.bookingId} reference={l.bookingReference} />
                <Muted>
                  Due <RelativeTime at={l.eligibleAt} now={now} />
                </Muted>
                {l.breachUnderReview ? (
                  <Badge variant="warning">Late delivery under review</Badge>
                ) : null}
              </div>
              <span className="font-semibold">{rupees(l.grossPaise)}</span>
            </li>
          ))}
        </ul>
      </SideSheet>
    </div>
  );
}
