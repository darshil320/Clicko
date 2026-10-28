'use client';

import { AdminConfirmIncidentBody, type AdminIncidentItem } from '@clickco/contracts';
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
import { formatCode } from '../../shared/format';
import { useAdminMutation } from '../../shared/mutation';
import { fieldError, NoteField } from '../../shared/note-field';
import { keys } from '../../shared/query';

/** Staff confirm an access-denied or unsafe-site report (ADR-0013 §staff confirmations). */
export function ConfirmIncidentDialog({
  item,
  kind,
  onClose,
}: {
  readonly item: AdminIncidentItem;
  readonly kind: AdminConfirmIncidentBody['kind'];
  readonly onClose: () => void;
}) {
  const [note, setNote] = useState('');
  const [touched, setTouched] = useState(false);
  const check = AdminConfirmIncidentBody.safeParse({ kind, note });

  const confirm = useAdminMutation({
    run: (vars: { assignmentId: string; body: AdminConfirmIncidentBody }, idem) =>
      adminApi.incidents.confirm(vars.assignmentId, vars.body, idem),
    success: () => `${formatCode(kind)} confirmed for ${item.reference}`,
    invalidate: [keys.incidents, keys.bookingAll, keys.bookingsAll],
    onSuccess: onClose,
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (check.success) confirm.mutate({ assignmentId: item.assignmentId, body: check.data });
  };

  return (
    <Dialog open onOpenChange={(open) => (!open && !confirm.isPending ? onClose() : undefined)}>
      <DialogContent>
        <form className="grid gap-4" onSubmit={submit} noValidate>
          <DialogHeader>
            <DialogTitle>
              Confirm {formatCode(kind).toLowerCase()} for {item.reference}?
            </DialogTitle>
            <DialogDescription>
              {item.photographerName} reported it. Confirming moves the booking on; it cannot be
              undone from the panel.
            </DialogDescription>
          </DialogHeader>
          <NoteField
            id="incident-note"
            label="What you checked"
            required
            hint="For example, who you spoke to and what they said. Saved in the audit log."
            value={note}
            onChange={setNote}
            error={touched ? fieldError(check, 'note') : null}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={confirm.isPending}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive" disabled={confirm.isPending}>
              {confirm.isPending ? <Spinner /> : null}
              Confirm incident
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
