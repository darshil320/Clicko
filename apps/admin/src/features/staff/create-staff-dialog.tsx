'use client';

import { AdminCreateStaffBody, type AdminCreateStaffResponse } from '@clickco/contracts';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  CopyField,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  KeyRoundIcon,
  PlusIcon,
  Separator,
  Spinner,
  toast,
  XIcon,
} from '@clickco/ui-web';
import { type FormEvent, useState } from 'react';
import type { CityRef } from '../../shared/access';
import { adminApi } from '../../shared/api';
import { useAdminMutation } from '../../shared/mutation';
import { fieldError } from '../../shared/note-field';
import { keys } from '../../shared/query';
import { EMPTY_GRANT, type GrantDraft, GrantFields, grantBody } from './grant-fields';
import { stepUpError } from './rules';
import { StepUpCodeField } from './step-up-code-field';

const MAX_GRANTS = 6;

/** The temporary password, shown once with a copy button (ADR-0025 D2). */
function Created({
  result,
  onDone,
}: {
  readonly result: AdminCreateStaffResponse;
  readonly onDone: () => void;
}) {
  return (
    <div className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{result.staff.fullName} can sign in</DialogTitle>
        <DialogDescription>
          Send them this temporary password over a private channel. It lasts 72 hours; at first
          sign-in they choose their own password and set up their authenticator.
        </DialogDescription>
      </DialogHeader>
      <Alert variant="warning">
        <KeyRoundIcon />
        <AlertTitle>Shown only once</AlertTitle>
        <AlertDescription>
          <p>Copy it now. Closing this window hides it for good.</p>
        </AlertDescription>
      </Alert>
      <CopyField
        label="temporary password"
        value={result.temporaryPassword}
        onCopyFailed={() => toast.error('Copy did not work — select the password instead')}
      />
      <DialogFooter>
        <Button onClick={onDone}>Done</Button>
      </DialogFooter>
    </div>
  );
}

/** Create a staff account (SUPER_ADMIN): email, name, at least one role. */
export function CreateStaffDialog({
  cities,
  onClose,
}: {
  readonly cities: ReadonlyArray<CityRef>;
  readonly onClose: () => void;
}) {
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [grants, setGrants] = useState<ReadonlyArray<GrantDraft>>([EMPTY_GRANT]);
  const [touched, setTouched] = useState(false);
  const [created, setCreated] = useState<AdminCreateStaffResponse | null>(null);
  const [code, setCode] = useState('');
  // A fresh authenticator code of the caller's (step-up, audit M3).
  const check = AdminCreateStaffBody.safeParse({
    code,
    email,
    fullName,
    grants: grants.map(grantBody),
  });

  const create = useAdminMutation({
    run: (body: AdminCreateStaffBody, idem) => adminApi.staff.create(body, idem),
    success: (body) => `Account created for ${body.fullName}`,
    invalidate: [keys.staff],
    onSuccess: setCreated,
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (check.success) create.mutate(check.data);
  };

  /** Drop the temporary password from memory as the dialog closes (security review L1). */
  const close = () => {
    setCreated(null);
    setCode('');
    create.reset();
    onClose();
  };

  const grantsError =
    touched && !check.success
      ? (check.error.issues.find((i) => i.path[0] === 'grants')?.message ?? null)
      : null;

  return (
    <Dialog open onOpenChange={(open) => (!open && !create.isPending ? close() : undefined)}>
      <DialogContent className="sm:max-w-2xl">
        {created ? (
          <Created result={created} onDone={close} />
        ) : (
          <form className="grid gap-4" onSubmit={submit} noValidate>
            <DialogHeader>
              <DialogTitle>Add a staff member</DialogTitle>
              <DialogDescription>
                They get a temporary password (valid 72 hours), then choose their own and set up
                their authenticator at first sign-in.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label="Work email"
                htmlFor="staff-email"
                error={touched ? fieldError(check, 'email') : null}
              >
                <Input
                  id="staff-email"
                  type="email"
                  autoComplete="off"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </Field>
              <Field
                label="Full name"
                htmlFor="staff-name"
                error={touched ? fieldError(check, 'fullName') : null}
              >
                <Input
                  id="staff-name"
                  autoComplete="off"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                />
              </Field>
            </div>
            <Separator />
            <div className="grid gap-4">
              {grants.map((draft, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: rows are edited in place, never reordered
                <div key={index} className="grid gap-2">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-sm">Role {index + 1}</span>
                    {grants.length > 1 ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setGrants(grants.filter((_, i) => i !== index))}
                      >
                        <XIcon />
                        Remove
                      </Button>
                    ) : null}
                  </div>
                  <GrantFields
                    idPrefix={`new-grant-${index}`}
                    draft={draft}
                    cities={cities}
                    onChange={(next) => setGrants(grants.map((g, i) => (i === index ? next : g)))}
                  />
                </div>
              ))}
              {grantsError ? (
                <p role="alert" className="text-destructive text-sm">
                  {grantsError}
                </p>
              ) : null}
              {grants.length < MAX_GRANTS ? (
                <Button
                  type="button"
                  variant="outline"
                  className="w-fit"
                  onClick={() => setGrants([...grants, EMPTY_GRANT])}
                >
                  <PlusIcon />
                  Add another role
                </Button>
              ) : null}
            </div>
            <Separator />
            <StepUpCodeField
              id="staff-create-code"
              value={code}
              onChange={setCode}
              disabled={create.isPending}
              error={(touched ? fieldError(check, 'code') : null) ?? stepUpError(create.error)}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={close} disabled={create.isPending}>
                Cancel
              </Button>
              <Button type="submit" disabled={create.isPending}>
                {create.isPending ? <Spinner /> : null}
                Create account
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
