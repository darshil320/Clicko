'use client';

import {
  type AdminReleaseWithheldBody,
  type AdminWithheldPayout,
  AdminReleaseWithheldBody as ReleaseSchema,
} from '@clickco/contracts';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  Button,
  RelativeTime,
  SectionHeader,
  Spinner,
} from '@clickco/ui-web';
import { useState } from 'react';
import { adminApi } from '../../shared/api';
import { AuthenticatorCodeField } from '../../shared/authenticator-code-field';
import { BookingLink, Muted } from '../../shared/cells';
import { useAdminMutation } from '../../shared/mutation';
import { fieldError, NoteField } from '../../shared/note-field';
import { BASIS, releaseConsequence, rupees } from './labels';
import { payoutKeys } from './shared';

/** Release one withheld payout: a note and a fresh authenticator code (ADR-0027 D5). */
function ReleaseDialog({
  payout,
  onClose,
}: {
  readonly payout: AdminWithheldPayout;
  readonly onClose: () => void;
}) {
  const [note, setNote] = useState('');
  const [code, setCode] = useState('');
  const [touched, setTouched] = useState(false);
  const check = ReleaseSchema.safeParse({ note, code });
  const release = useAdminMutation({
    run: (vars: { body: AdminReleaseWithheldBody }, idem) =>
      adminApi.payouts.releaseWithheld(payout.payoutId, vars.body, idem),
    success: () => `${rupees(payout.grossPaise)} for ${payout.photographerName} is due again`,
    invalidate: [payoutKeys.all],
    onSuccess: onClose,
  });
  const confirm = () => {
    setTouched(true);
    if (check.success) release.mutate({ body: check.data }, { onError: () => setCode('') });
  };

  return (
    <AlertDialog open onOpenChange={(o) => (!o && !release.isPending ? onClose() : undefined)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Pay {payout.photographerName} after all?</AlertDialogTitle>
          <AlertDialogDescription>
            {releaseConsequence(payout.grossPaise, payout.photographerName)}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="grid gap-4">
          <NoteField
            id={`release-note-${payout.payoutId}`}
            label="Why it is released"
            required
            hint="Saved in the audit log with your name."
            value={note}
            onChange={setNote}
            disabled={release.isPending}
            error={touched ? fieldError(check, 'note') : null}
          />
          <AuthenticatorCodeField
            id={`release-code-${payout.payoutId}`}
            hint="Releasing money needs a fresh code."
            value={code}
            onChange={setCode}
            error={touched ? fieldError(check, 'code') : null}
            disabled={release.isPending}
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={release.isPending}>Cancel</AlertDialogCancel>
          <Button onClick={confirm} disabled={release.isPending}>
            {release.isPending ? <Spinner /> : null}
            Release {rupees(payout.grossPaise)}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * "Held back" on the Due tab (domain review M): payouts withheld instead of falling due — today
 * a third data loss in a year (DOMAIN §2). They are never batched until finance releases one.
 * Nothing shows when none are held.
 */
export function WithheldSection({
  payouts,
  now,
}: {
  readonly payouts: ReadonlyArray<AdminWithheldPayout>;
  readonly now: number;
}) {
  const [releasing, setReleasing] = useState<AdminWithheldPayout | null>(null);
  if (payouts.length === 0) return null;
  return (
    <section className="grid gap-4">
      <SectionHeader
        title="Held back"
        description="Not paid until you release them. Each says why it was held."
      />
      <ul className="grid gap-3">
        {payouts.map((p) => (
          <li
            key={p.payoutId}
            className="flex flex-wrap items-start justify-between gap-4 rounded-md border p-4"
          >
            <div className="grid gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{p.photographerName}</span>
                <Badge variant="warning">{BASIS[p.basis]}</Badge>
              </div>
              <BookingLink id={p.bookingId} reference={p.bookingReference} />
              <span className="text-sm">{p.reason}</span>
              <Muted>
                Would have been due <RelativeTime at={p.eligibleAt} now={now} />
              </Muted>
            </div>
            <div className="grid justify-items-end gap-2">
              <span className="font-semibold">{rupees(p.grossPaise)}</span>
              <Button variant="outline" size="sm" onClick={() => setReleasing(p)}>
                Release
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {releasing ? <ReleaseDialog payout={releasing} onClose={() => setReleasing(null)} /> : null}
    </section>
  );
}
