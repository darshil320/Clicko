'use client';

import { AdminGrantBody, type AdminStaffRow } from '@clickco/contracts';
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
import type { CityRef } from '../../shared/access';
import { adminApi } from '../../shared/api';
import { formatCode } from '../../shared/format';
import { useAdminMutation } from '../../shared/mutation';
import { fieldError } from '../../shared/note-field';
import { keys } from '../../shared/query';
import { EMPTY_GRANT, GrantFields, grantBody } from './grant-fields';

/** Add a role to a staff member (city required for a city manager). */
export function GrantDialog({
  staff,
  cities,
  onClose,
}: {
  readonly staff: AdminStaffRow;
  readonly cities: ReadonlyArray<CityRef>;
  readonly onClose: () => void;
}) {
  const [draft, setDraft] = useState(EMPTY_GRANT);
  const [touched, setTouched] = useState(false);
  const check = AdminGrantBody.safeParse(grantBody(draft));

  const grant = useAdminMutation({
    run: (vars: { staffId: string; body: AdminGrantBody }, idem) =>
      adminApi.staff.grant(vars.staffId, vars.body, idem),
    success: (vars) => `${staff.fullName} is now ${formatCode(vars.body.role).toLowerCase()}`,
    invalidate: [keys.staff],
    onSuccess: onClose,
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (check.success) grant.mutate({ staffId: staff.id, body: check.data });
  };

  return (
    <Dialog open onOpenChange={(open) => (!open && !grant.isPending ? onClose() : undefined)}>
      <DialogContent>
        <form className="grid gap-4" onSubmit={submit} noValidate>
          <DialogHeader>
            <DialogTitle>Add a role for {staff.fullName}</DialogTitle>
            <DialogDescription>
              Roles decide which desks they see. A city manager only sees their city.
            </DialogDescription>
          </DialogHeader>
          <GrantFields
            idPrefix="grant"
            draft={draft}
            cities={cities}
            onChange={setDraft}
            cityError={touched ? fieldError(check, 'cityId') : null}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={grant.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={grant.isPending}>
              {grant.isPending ? <Spinner /> : null}
              Add role
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
