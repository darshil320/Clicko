'use client';

import { AdminQaDecisionBody, type AdminQaItem, type QaResult } from '@clickco/contracts';
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
import { useAdminMutation } from '../../shared/mutation';
import { fieldError, NoteField } from '../../shared/note-field';
import { keys } from '../../shared/query';

/** Pass or fail one delivery (ADR-0025 D5). A fail needs a note for the photographer. */
export function DecideDialog({
  item,
  result,
  onClose,
}: {
  readonly item: AdminQaItem;
  readonly result: QaResult;
  readonly onClose: () => void;
}) {
  const [note, setNote] = useState('');
  const [touched, setTouched] = useState(false);
  const body = { result, ...(note.trim() ? { note } : {}) };
  const check = AdminQaDecisionBody.safeParse(body);
  const passing = result === 'PASS';

  const decide = useAdminMutation({
    run: (vars: { bookingId: string; body: AdminQaDecisionBody }, idem) =>
      adminApi.qa.decide(vars.bookingId, vars.body, idem),
    success: () => `QA ${passing ? 'passed' : 'failed'} for ${item.reference}`,
    invalidate: [keys.qa, keys.bookingAll, keys.bookingsAll],
    onSuccess: onClose,
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (check.success) decide.mutate({ bookingId: item.bookingId, body: check.data });
  };

  return (
    <Dialog open onOpenChange={(open) => (!open && !decide.isPending ? onClose() : undefined)}>
      <DialogContent>
        <form className="grid gap-4" onSubmit={submit} noValidate>
          <DialogHeader>
            <DialogTitle>
              {passing ? 'Pass' : 'Fail'} QA for {item.reference}?
            </DialogTitle>
            <DialogDescription>
              {passing
                ? `The delivery from ${item.photographerName} goes to the client.`
                : `${item.photographerName} is told why and asked to fix the delivery.`}
            </DialogDescription>
          </DialogHeader>
          <NoteField
            id="qa-note"
            label={passing ? 'Note' : 'Why it failed'}
            required={!passing}
            hint={passing ? 'Saved in the audit log.' : 'The photographer sees this.'}
            value={note}
            onChange={setNote}
            error={touched ? fieldError(check, 'note') : null}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={decide.isPending}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant={passing ? 'default' : 'destructive'}
              disabled={decide.isPending}
            >
              {decide.isPending ? <Spinner /> : null}
              {passing ? 'Pass QA' : 'Fail QA'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
