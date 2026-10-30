'use client';

import type { AdminPayoutBatchDetail, AdminPayoutTransfer } from '@clickco/contracts';
import {
  ArrowLeftIcon,
  Badge,
  Button,
  type ColumnDef,
  DataTable,
  EmptyState,
  PageHeader,
  SectionHeader,
  Skeleton,
  Spinner,
  StatCard,
  StatGrid,
} from '@clickco/ui-web';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { adminApi } from '../../shared/api';
import { Muted } from '../../shared/cells';
import { describeError } from '../../shared/errors';
import { formatDateTime } from '../../shared/format';
import { useAdminMutation } from '../../shared/mutation';
import {
  BATCH_STATE,
  count,
  maskedAccount,
  rupees,
  TRANSFER_STATE,
  toPhotographers,
} from './labels';
import { MarkPaidSheet } from './mark-paid-sheet';
import { Confirm, payoutKeys, saveFile } from './shared';
import { TransferSheet } from './transfer-sheet';

const COLUMNS: ReadonlyArray<ColumnDef<AdminPayoutTransfer>> = [
  {
    id: 'name',
    header: 'Photographer',
    accessorFn: (t) => t.name,
    cell: ({ row }) => (
      <div className="grid">
        <span className="font-semibold">{row.original.name}</span>
        <Muted>{row.original.reference ?? count(row.original.lines.length, 'job')}</Muted>
      </div>
    ),
  },
  {
    id: 'bank',
    header: 'Bank',
    enableSorting: false,
    cell: ({ row }) =>
      row.original.bank ? (
        <div className="grid">
          <span>{maskedAccount(row.original.bank)}</span>
          <Muted>{row.original.bank.ifsc}</Muted>
        </div>
      ) : (
        <Muted>—</Muted>
      ),
  },
  {
    id: 'amounts',
    header: 'Earned · TDS · deductions',
    enableSorting: false,
    cell: ({ row }) => (
      <Muted>
        {rupees(row.original.grossPaise)} · {rupees(row.original.tdsPaise)} ·{' '}
        {rupees(row.original.deductionsPaise)}
      </Muted>
    ),
  },
  {
    id: 'net',
    header: 'To the bank',
    accessorFn: (t) => t.netPaise,
    cell: ({ row }) => <span className="font-semibold">{rupees(row.original.netPaise)}</span>,
  },
  {
    id: 'state',
    header: 'Status',
    accessorFn: (t) => t.state,
    cell: ({ row }) => {
      const t = row.original;
      const s = TRANSFER_STATE[t.state];
      return (
        <div className="grid gap-1">
          <Badge variant={s.tone}>{s.label}</Badge>
          {t.utr ? <Muted>UTR {t.utr}</Muted> : null}
          {t.failureReason ? <Muted>{t.failureReason}</Muted> : null}
        </div>
      );
    },
  },
];

type Step = 'export' | 'discard' | 'paid' | 'file' | null;

/** One batch (a long record, its own page): review → export the bank file → mark paid. */
export function BatchPage({ batchId }: { readonly batchId: string }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(null);
  const [open, setOpen] = useState<string | null>(null);
  const batch = useQuery({
    queryKey: payoutKeys.batch(batchId),
    queryFn: () => adminApi.payouts.batches.get(batchId),
  });

  // The file holds full account numbers: saved, then dropped from memory at once.
  const bankFile = useAdminMutation({
    run: (_: null, idem) => adminApi.payouts.batches.createBankFile(batchId, idem),
    success: (_, file) =>
      `Bank file saved with ${count(file.rowCount, 'transfer')}. Upload it to your bank.`,
    invalidate: [payoutKeys.all],
    onSuccess: (file) => saveFile(file),
  });
  const makeFile = () => {
    setStep(null);
    bankFile.mutate(null, { onSettled: () => bankFile.reset() });
  };
  const exportBatch = useAdminMutation({
    run: (_: null, idem) => adminApi.payouts.batches.export(batchId, idem),
    success: (_, b) => `${b.reference} exported.`,
    invalidate: [payoutKeys.all],
    onSuccess: (b) => {
      setStep(null);
      if (b.transfersReady > 0) makeFile();
    },
  });
  const discard = useAdminMutation({
    run: (_: null, idem) => adminApi.payouts.batches.discard(batchId, idem),
    success: (_, r) => `Draft ${r.reference} discarded. Its payouts are back in Due.`,
    invalidate: [payoutKeys.all],
    onSuccess: () => router.push('/payouts'),
  });

  const back = (
    <Button variant="ghost" asChild>
      <Link href="/payouts">
        <ArrowLeftIcon />
        Payouts
      </Link>
    </Button>
  );

  if (batch.isPending) return <Skeleton className="h-64 w-full" />;
  if (batch.isError) {
    return (
      <EmptyState
        title="This batch could not be loaded"
        description={describeError(batch.error).message}
        action={back}
      />
    );
  }
  const b: AdminPayoutBatchDetail = batch.data;
  const state = BATCH_STATE[b.state];
  const awaiting = b.transfers.filter((t) => t.state === 'AWAITING_PAYMENT');
  const ready = b.transfers.filter((t) => t.state === 'READY_FOR_BANK_FILE');
  const readyTotal = ready.reduce((s, t) => s + BigInt(t.netPaise), 0n);
  const transfer = b.transfers.find((t) => t.photographerId === open) ?? null;

  const actions =
    b.state === 'DRAFT' ? (
      <>
        <Button variant="outline" onClick={() => setStep('discard')}>
          Discard draft
        </Button>
        <Button onClick={() => setStep('export')}>Export bank file</Button>
      </>
    ) : ready.length > 0 ? (
      <Button disabled={bankFile.isPending} onClick={() => setStep('file')}>
        {bankFile.isPending ? <Spinner /> : null}
        Create bank file ({ready.length})
      </Button>
    ) : awaiting.length > 0 ? (
      <Button onClick={() => setStep('paid')}>Mark as paid</Button>
    ) : null;

  return (
    <div className="grid gap-8">
      <div>
        {back}
        <PageHeader
          eyebrow={b.kind === 'WEEKLY' ? 'Weekly run' : 'Off-cycle batch'}
          title={
            <span className="flex flex-wrap items-center gap-3">
              {b.reference}
              <Badge variant={state.tone}>{state.label}</Badge>
            </span>
          }
          description={
            b.state === 'DRAFT'
              ? `Made ${formatDateTime(b.createdAt)} with everything due then. Check the amounts, then export the bank file.`
              : b.state === 'PAID'
                ? `All settled${b.paidAt ? ` on ${formatDateTime(b.paidAt)}` : ''}.`
                : `Sent to the bank ${b.exportedAt ? formatDateTime(b.exportedAt) : ''}. Mark each transfer paid when the bank confirms it.`
          }
          actions={actions}
        />
      </div>

      <StatGrid>
        <StatCard
          label="To the bank"
          value={rupees(b.netPaise)}
          hint={count(b.payeeCount, 'photographer')}
          tone={
            awaiting.length > 0 || ready.length > 0 || b.state === 'DRAFT' ? 'attention' : 'neutral'
          }
        />
        <StatCard label="Earned" value={rupees(b.grossPaise)} hint={count(b.payoutCount, 'job')} />
        <StatCard label="TDS" value={rupees(b.tdsPaise)} hint="Deposit by the 7th of next month" />
        <StatCard
          label="Deductions"
          value={rupees(b.deductionsPaise)}
          hint="Late deliveries, penalties, amounts owed"
        />
      </StatGrid>

      {b.transfersFailed > 0 ? (
        <p className="text-sm">
          <Badge variant="destructive">{count(b.transfersFailed, 'transfer')} failed</Badge> Open it
          to send it again.
        </p>
      ) : null}

      <section className="grid gap-4">
        <SectionHeader
          title="Transfers"
          description="One bank transfer per photographer. Open one for the breakdown and the statement."
        />
        <DataTable
          caption={`Transfers in ${b.reference}`}
          columns={COLUMNS}
          data={b.transfers}
          getRowId={(t) => t.photographerId}
          onRowClick={(t) => setOpen(t.photographerId)}
          rowLabel={(t) => `Open ${t.name}'s transfer`}
        />
      </section>

      {step === 'export' ? (
        <Confirm
          title={`Export ${toPhotographers(b.netPaise, b.payeeCount)}?`}
          description={`The amounts lock, TDS of ${rupees(b.tdsPaise)} is booked and the bank file downloads. Upload it to your bank's bulk NEFT; nothing moves until you do.`}
          confirmLabel="Export bank file"
          pending={exportBatch.isPending}
          onConfirm={() => exportBatch.mutate(null)}
          onClose={() => setStep(null)}
        />
      ) : null}
      {step === 'discard' ? (
        <Confirm
          destructive
          title={`Discard draft ${b.reference}?`}
          description={`Nothing has been paid. ${toPhotographers(b.grossPaise, b.payeeCount)} goes back to Due, ready for a new batch.`}
          confirmLabel="Discard draft"
          pending={discard.isPending}
          onConfirm={() => discard.mutate(null)}
          onClose={() => setStep(null)}
        />
      ) : null}
      {step === 'file' ? (
        <Confirm
          title={`Create a bank file for ${toPhotographers(readyTotal, ready.length)}?`}
          description="Each transfer goes into one bank file only, so uploading it can never pay anyone twice. If the bank returns one, mark it failed and send it again: it goes into the next file."
          confirmLabel="Create bank file"
          pending={bankFile.isPending}
          onConfirm={makeFile}
          onClose={() => setStep(null)}
        />
      ) : null}
      {step === 'paid' ? <MarkPaidSheet batch={b} onClose={() => setStep(null)} /> : null}
      {transfer ? (
        <TransferSheet batchId={b.id} transfer={transfer} onClose={() => setOpen(null)} />
      ) : null}
    </div>
  );
}
