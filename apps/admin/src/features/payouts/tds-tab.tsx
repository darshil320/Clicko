'use client';

import type { AdminTdsMonthRow } from '@clickco/contracts';
import {
  Badge,
  Button,
  type ColumnDef,
  DataTable,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  StatCard,
  StatGrid,
  toast,
} from '@clickco/ui-web';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { adminApi } from '../../shared/api';
import { Muted } from '../../shared/cells';
import { describeError } from '../../shared/errors';
import { formatDay } from '../../shared/format';
import { useNow } from '../../shared/use-now';
import { count, istToday, monthLabel, percent, rupees } from './labels';
import { payoutKeys, saveFile } from './shared';

function columns(
  today: string,
  download: (month: string) => void,
  busy: boolean,
): ReadonlyArray<ColumnDef<AdminTdsMonthRow>> {
  return [
    {
      id: 'month',
      header: 'Month',
      accessorFn: (m) => m.month,
      cell: ({ row }) => <span className="font-semibold">{monthLabel(row.original.month)}</span>,
    },
    {
      id: 'paid',
      header: 'Paid',
      enableSorting: false,
      cell: ({ row }) => (
        <div className="grid">
          <span>{rupees(row.original.grossPaise)}</span>
          <Muted>{count(row.original.payeeCount, 'photographer')}</Muted>
        </div>
      ),
    },
    {
      id: 'tds',
      header: 'TDS',
      enableSorting: false,
      cell: ({ row }) => <span className="font-semibold">{rupees(row.original.tdsPaise)}</span>,
    },
    {
      id: 'due',
      header: 'Deposit by',
      accessorFn: (m) => m.depositDueOn,
      cell: ({ row }) => {
        const m = row.original;
        return (
          <div className="grid gap-1">
            <span>{formatDay(m.depositDueOn)}</span>
            {m.tdsPaise > 0n && m.depositDueOn < today ? (
              <Badge variant="neutral">Due date passed</Badge>
            ) : null}
          </div>
        );
      },
    },
    {
      id: 'actions',
      header: () => <span className="sr-only">Report</span>,
      enableSorting: false,
      cell: ({ row }) =>
        row.original.payoutCount === 0 ? null : (
          <div className="flex justify-end">
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => download(row.original.month)}
            >
              Download for the CA
            </Button>
          </div>
        ),
    },
  ];
}

/** TDS month by month (deposit by the 7th; the CA files 26Q and issues Form 16A). */
export function TdsTab() {
  const now = useNow();
  const [fy, setFy] = useState<string | null>(null);
  const summary = useQuery({
    queryKey: payoutKeys.tds(fy),
    queryFn: () => adminApi.payouts.tds.summary(fy ? { fy } : {}),
  });
  const report = useMutation({
    gcTime: 0,
    mutationFn: (month: string) => adminApi.payouts.tds.report(month),
    onSuccess: (file) => saveFile(file),
    onError: (error) => toast.error(describeError(error).message),
  });
  const { mutate, reset } = report;
  const cols = useMemo(
    () => columns(istToday(now), (m) => mutate(m, { onSettled: () => reset() }), report.isPending),
    [now, mutate, reset, report.isPending],
  );
  const s = summary.data;

  return (
    <div className="grid gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <p className="max-w-prose text-muted-foreground text-sm">
          {s
            ? `Section ${s.rules.section}: ${percent(s.rules.individualRateBps)} for individuals and HUFs, ${percent(s.rules.otherRateBps)} for others, ${percent(s.rules.noPanRateBps)} without a valid PAN. No TDS while each payment is up to ${rupees(s.rules.singlePaymentLimitPaise)} and the year stays within ${rupees(s.rules.yearlyLimitPaise)}.`
            : 'Loading the rules…'}
        </p>
        {s ? (
          <Select value={s.financialYear} onValueChange={setFy}>
            <SelectTrigger aria-label="Financial year" className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {s.financialYears.map((y) => (
                <SelectItem key={y} value={y}>
                  FY {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </div>
      <StatGrid>
        <StatCard
          label={s ? `Paid in FY ${s.financialYear}` : 'Paid this year'}
          value={s ? rupees(s.grossPaise) : '—'}
        />
        <StatCard
          label="TDS deducted"
          value={s ? rupees(s.tdsPaise) : '—'}
          hint="Deposit each month's TDS by the 7th of the next month (March's by 30 April)"
        />
      </StatGrid>
      <DataTable
        caption="TDS by month"
        columns={cols}
        data={s?.months ?? []}
        getRowId={(m) => m.month}
        isLoading={summary.isPending}
        error={summary.isError ? describeError(summary.error).message : null}
        onRetry={() => void summary.refetch()}
        emptyTitle="No payouts this year"
      />
    </div>
  );
}
