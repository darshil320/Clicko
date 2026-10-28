'use client';

import {
  AdminAttributeBreachBody,
  type AdminBreachItem,
  BreachReattribution,
} from '@clickco/contracts';
import {
  Alert,
  AlertDescription,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
} from '@clickco/ui-web';
import { type FormEvent, useState } from 'react';
import { adminApi } from '../../shared/api';
import { formatCode } from '../../shared/format';
import { useAdminMutation } from '../../shared/mutation';
import { fieldError, NoteField } from '../../shared/note-field';
import { keys } from '../../shared/query';

/** Who caused the delay (ADR-0016). Money is never moved here (S10). */
export function AttributeDialog({
  breach,
  onClose,
}: {
  readonly breach: AdminBreachItem;
  readonly onClose: () => void;
}) {
  const [attributedTo, setAttributedTo] = useState<BreachReattribution>(
    breach.attributedTo === 'FORCE_MAJEURE' ? 'FORCE_MAJEURE' : 'CLIENT',
  );
  const [note, setNote] = useState('');
  const [touched, setTouched] = useState(false);
  const check = AdminAttributeBreachBody.safeParse({ attributedTo, note });

  const attribute = useAdminMutation({
    run: (vars: { breachId: string; body: AdminAttributeBreachBody }, idem) =>
      adminApi.breaches.attribute(vars.breachId, vars.body, idem),
    success: (vars) =>
      `${breach.reference}: delay put down to ${formatCode(vars.body.attributedTo).toLowerCase()}`,
    invalidate: [keys.breachesAll, keys.bookingAll, keys.bookingsAll],
    onSuccess: onClose,
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (check.success) attribute.mutate({ breachId: breach.id, body: check.data });
  };

  return (
    <Dialog open onOpenChange={(open) => (!open && !attribute.isPending ? onClose() : undefined)}>
      <DialogContent>
        <form className="grid gap-4" onSubmit={submit} noValidate>
          <DialogHeader>
            <DialogTitle>Who caused the delay on {breach.reference}?</DialogTitle>
            <DialogDescription>
              {formatCode(breach.kind)} was {breach.delayMinutes} minutes late.
            </DialogDescription>
          </DialogHeader>
          <Field label="Attributed to" htmlFor="attributed-to">
            <Select
              value={attributedTo}
              onValueChange={(value) => setAttributedTo(BreachReattribution.parse(value))}
            >
              <SelectTrigger id="attributed-to">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BreachReattribution.options.map((option) => (
                  <SelectItem key={option} value={option}>
                    {formatCode(option)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Alert variant="info">
            <AlertDescription>
              Put down to {formatCode(attributedTo).toLowerCase()}: the client gets no remedy and
              the photographer’s payout is not reduced. Now attributed to{' '}
              {formatCode(breach.attributedTo).toLowerCase()}.
            </AlertDescription>
          </Alert>
          <NoteField
            id="attribute-note"
            label="Why"
            required
            hint="Saved in the audit log."
            value={note}
            onChange={setNote}
            error={touched ? fieldError(check, 'note') : null}
          />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={attribute.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={attribute.isPending}>
              {attribute.isPending ? <Spinner /> : null}
              Save attribution
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
