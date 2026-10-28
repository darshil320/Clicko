'use client';

import { type AdminBreachItem, AdminWaiveBreachBody } from '@clickco/contracts';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Spinner,
} from '@clickco/ui-web';
import { type FormEvent, useState } from 'react';
import { adminApi } from '../../shared/api';
import { formatCode, formatMoney } from '../../shared/format';
import { useAdminMutation } from '../../shared/mutation';
import { fieldError, NoteField } from '../../shared/note-field';
import { keys } from '../../shared/query';

/** Waive a breach: no remedy will be applied for it (ADR-0025 D5). */
export function WaiveDialog({
  breach,
  onClose,
}: {
  readonly breach: AdminBreachItem;
  readonly onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const check = AdminWaiveBreachBody.safeParse({ reason });

  const waive = useAdminMutation({
    run: (vars: { breachId: string; body: AdminWaiveBreachBody }, idem) =>
      adminApi.breaches.waive(vars.breachId, vars.body, idem),
    success: () => `Breach waived on ${breach.reference}`,
    invalidate: [keys.breachesAll, keys.bookingAll, keys.bookingsAll],
    onSuccess: onClose,
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (check.success) waive.mutate({ breachId: breach.id, body: check.data });
  };

  return (
    <Dialog open onOpenChange={(open) => (!open && !waive.isPending ? onClose() : undefined)}>
      <DialogContent>
        <form className="grid gap-4" onSubmit={submit} noValidate>
          <DialogHeader>
            <DialogTitle>Waive the breach on {breach.reference}?</DialogTitle>
            <DialogDescription>
              {formatCode(breach.kind)} · {formatCode(breach.remedyKind)} of{' '}
              {formatMoney(breach.remedyPaise, true)} will not be applied. This cannot be undone
              from the panel.
            </DialogDescription>
          </DialogHeader>
          <NoteField
            id="waive-reason"
            label="Reason"
            required
            hint="Saved in the audit log."
            value={reason}
            onChange={setReason}
            error={touched ? fieldError(check, 'reason') : null}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={waive.isPending}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive" disabled={waive.isPending}>
              {waive.isPending ? <Spinner /> : null}
              Waive breach
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
