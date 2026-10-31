'use client';

import {
  type AdminPayoutBatchDetail,
  type AdminPayoutTransfer,
  StepUpCode,
} from '@clickco/contracts';
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
import { AuthenticatorCodeField } from '../../shared/authenticator-code-field';
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
  // Audit H2: export, the bank file and marking paid each need a fresh authenticator code.
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const withCode = (run: (code: string) => void) => {
    const parsed = StepUpCode.safeParse(code);
    if (!parsed.success) {
      setCodeError(parsed.error.issues[0]?.message ?? 'Enter the 6-digit code');
      return;
    }
    setCodeError(null);
    run(parsed.data);
  };
  const closeStep = () => {
    setStep(null);
    setCode('');
    setCodeError(null);
  };
  const batch = useQuery({
    queryKey: payoutKeys.batch(batchId),
    queryFn: () => adminApi.payouts.batches.get(batchId),
  });

  // The file holds full account numbers: saved, then dropped from memory at once.
  const bankFile = useAdminMutation({
    run: (vars: { code: string }, idem) =>
      adminApi.payouts.batches.createBankFile(batchId, vars, idem),
    success: (_, file) =>
      `Bank file saved with ${count(file.rowCount, 'transfer')}. Upload it to your bank.`,
    invalidate: [payoutKeys.all],
    onSuccess: (file) => saveFile(file),
  });
  const makeFile = () =>
    withCode((c) =>
      bankFile.mutate(
        { code: c },
        {
          onSuccess: closeStep,
          onError: () => setCode(''),
          onSettled: () => bankFile.reset(),
        },
      ),
    );
  const exportBatch = useAdminMutation({
    run: (vars: { code: string }, idem) => adminApi.payouts.batches.export(batchId, vars, idem),
    success: (_, b) => `${b.reference} exported.`,
    invalidate: [payoutKeys.all],
    onSuccess: (b) => {
      closeStep();
      // The bank file is its own step with its own fresh code (a code works once).
      if (b.transfersReady > 0) setStep('file');
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
          description={
            <span className="grid gap-3">
              <span>
                The amounts lock and TDS of {rupees(b.tdsPaise)} is booked. Next you create the bank
                file and upload it to your bank's bulk NEFT; nothing moves until you do.
              </span>
              <AuthenticatorCodeField
                id="export-code"
                hint="Exporting a payout batch needs a fresh code, even though you are signed in."
                value={code}
                onChange={setCode}
                error={codeError}
              />
            </span>
          }
          confirmLabel="Export"
          pending={exportBatch.isPending}
          onConfirm={() =>
            withCode((c) => exportBatch.mutate({ code: c }, { onError: () => setCode('') }))
          }
          onClose={closeStep}
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
          onClose={closeStep}
        />
      ) : null}
      {step === 'file' ? (
        <Confirm
          title={`Create a bank file for ${toPhotographers(readyTotal, ready.length)}?`}
          description={
            <span className="grid gap-3">
              <span>
                Each transfer goes into one bank file only, so uploading it can never pay anyone
                twice. If the bank returns one, another finance person marks it failed with the
                bank's return reference and sends it again: it goes into the next file.
              </span>
              <AuthenticatorCodeField
                id="bank-file-code"
                hint="The bank file holds full account numbers, so it needs a fresh code."
                value={code}
                onChange={setCode}
                error={codeError}
              />
            </span>
          }
          confirmLabel="Create bank file"
          pending={bankFile.isPending}
          onConfirm={makeFile}
          onClose={closeStep}
        />
      ) : null}
      {step === 'paid' ? <MarkPaidSheet batch={b} onClose={closeStep} /> : null}
      {transfer ? (
        <TransferSheet batchId={b.id} transfer={transfer} onClose={() => setOpen(null)} />
      ) : null}
    </div>
  );
}
