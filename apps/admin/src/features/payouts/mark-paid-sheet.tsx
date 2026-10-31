'use client';

import { type AdminPayoutBatchDetail, PayoutUtr, StepUpCode } from '@clickco/contracts';
import { Button, Field, Input, SideSheet, Spinner } from '@clickco/ui-web';
import { useState } from 'react';
import { adminApi } from '../../shared/api';
import { AuthenticatorCodeField } from '../../shared/authenticator-code-field';
import { useAdminMutation } from '../../shared/mutation';
import { count, maskedAccount, rupeesExact } from './labels';
import { payoutKeys } from './shared';

/**
 * Mark transfers paid with the bank's UTR (ADR-0026 D3): one field per transfer; blank rows stay
 * waiting. A UTR identifies exactly one transfer (audit L7), and marking paid needs a fresh
 * authenticator code (audit H2).
 */
export function MarkPaidSheet({
  batch,
  onClose,
}: {
  readonly batch: AdminPayoutBatchDetail;
  readonly onClose: () => void;
}) {
  const waiting = batch.transfers.filter((t) => t.state === 'AWAITING_PAYMENT');
  const [utrs, setUtrs] = useState<Readonly<Record<string, string>>>({});
  const [touched, setTouched] = useState(false);
  const [code, setCode] = useState('');
  const codeCheck = StepUpCode.safeParse(code);

  const filled = waiting.flatMap((t) => {
    const raw = (utrs[t.photographerId] ?? '').trim();
    return raw === '' ? [] : [{ photographerId: t.photographerId, utr: raw, name: t.name }];
  });
  const invalid = filled.filter((f) => !PayoutUtr.safeParse(f.utr).success);
  const total = waiting
    .filter((t) => filled.some((f) => f.photographerId === t.photographerId))
    .reduce((s, t) => s + BigInt(t.netPaise), 0n);

  const mark = useAdminMutation({
    run: (
      vars: {
        code: string;
        transfers: ReadonlyArray<{ photographerId: string; utr: string }>;
      },
      idem,
    ) =>
      adminApi.payouts.batches.markPaid(
        batch.id,
        { code: vars.code, transfers: [...vars.transfers] },
        idem,
      ),
    success: (vars) => `${count(vars.transfers.length, 'transfer')} marked paid`,
    invalidate: [payoutKeys.all],
    onSuccess: onClose,
  });

  const submit = () => {
    setTouched(true);
    if (filled.length === 0 || invalid.length > 0 || !codeCheck.success) return;
    mark.mutate(
      {
        code: codeCheck.data,
        transfers: filled.map(({ photographerId, utr }) => ({ photographerId, utr })),
      },
      { onError: () => setCode('') },
    );
  };

  return (
    <SideSheet
      open
      size="lg"
      onOpenChange={(o) => (!o && !mark.isPending ? onClose() : undefined)}
      title="Mark as paid"
      description={`Type the bank's reference (UTR) for each transfer that went through. ${count(waiting.length, 'transfer')} waiting.`}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-muted-foreground text-sm">
            {filled.length > 0
              ? `${rupeesExact(total)} to ${count(filled.length, 'photographer')}`
              : 'Nothing filled in yet'}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={mark.isPending}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={mark.isPending || filled.length === 0}>
              {mark.isPending ? <Spinner /> : null}
              Mark {filled.length > 0 ? count(filled.length, 'transfer') : 'paid'}
            </Button>
          </div>
        </div>
      }
    >
      <div className="grid gap-6">
        <ul className="grid gap-4">
          {waiting.map((t) => {
            const id = `utr-${t.photographerId}`;
            const bad = touched && invalid.some((f) => f.photographerId === t.photographerId);
            return (
              <li key={t.photographerId}>
                <Field
                  htmlFor={id}
                  label={`${t.name} · ${rupeesExact(t.netPaise)}`}
                  hint={`${t.reference ?? ''}${t.bank ? ` · ${maskedAccount(t.bank)}` : ''}`}
                  error={bad ? 'Enter the UTR: 6 to 30 letters and digits' : null}
                >
                  <Input
                    id={id}
                    autoComplete="off"
                    value={utrs[t.photographerId] ?? ''}
                    aria-invalid={bad ? true : undefined}
                    aria-describedby={bad ? `${id}-error` : undefined}
                    onChange={(e) =>
                      setUtrs((prev) => ({ ...prev, [t.photographerId]: e.target.value }))
                    }
                  />
                </Field>
              </li>
            );
          })}
        </ul>
        <AuthenticatorCodeField
          id="mark-paid-code"
          hint="Each UTR belongs to one transfer only. Marking money paid needs a fresh code."
          value={code}
          onChange={setCode}
          error={
            touched && !codeCheck.success
              ? 'Enter the 6-digit code from your authenticator app'
              : null
          }
        />
      </div>
    </SideSheet>
  );
}
