'use client';

import { STAFF_PASSWORD_POLICY, staffPasswordProblem } from '@clickco/contracts';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  Spinner,
} from '@clickco/ui-web';
import { type FormEvent, useState } from 'react';
import { adminApi } from '../../shared/api';
import { describeError } from '../../shared/errors';
import { useAdminMutation } from '../../shared/mutation';

const CODE = /^\d{6}$/;

interface Draft {
  readonly currentPassword: string;
  readonly newPassword: string;
  readonly confirm: string;
  readonly code: string;
}

const EMPTY: Draft = { currentPassword: '', newPassword: '', confirm: '', code: '' };

/** The first thing wrong with the form, per field (null when it can be sent). */
function problems(draft: Draft, email: string) {
  return {
    currentPassword: draft.currentPassword ? null : 'Enter your current password',
    newPassword: staffPasswordProblem(draft.newPassword, {
      email,
      previous: draft.currentPassword,
    }),
    confirm: draft.confirm === draft.newPassword ? null : 'The two new passwords don’t match',
    code: CODE.test(draft.code) ? null : 'Enter the 6-digit code from your authenticator app',
  };
}

/**
 * "Change password" (ADR-0026 D7): current password, a new one (12+ characters, not the email,
 * not the current one), and a fresh authenticator code. Every other session ends; this tab
 * keeps going on the new session the server returns.
 */
export function ChangePasswordDialog({
  email,
  onClose,
}: {
  readonly email: string;
  readonly onClose: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [touched, setTouched] = useState(false);
  const check = problems(draft, email);
  const ok = Object.values(check).every((p) => p === null);

  const change = useAdminMutation({
    run: (body: { currentPassword: string; newPassword: string; code: string }) =>
      adminApi.auth.changePassword(body),
    success: () => 'Password changed. You were signed out everywhere else.',
    invalidate: [],
    onSuccess: () => {
      setDraft(EMPTY);
      onClose();
    },
  });

  const set = (field: keyof Draft) => (value: string) => {
    change.reset();
    setDraft({
      ...draft,
      [field]: field === 'code' ? value.replace(/\D/g, '').slice(0, 6) : value,
    });
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (!ok) return;
    change.mutate({
      currentPassword: draft.currentPassword,
      newPassword: draft.newPassword,
      code: draft.code,
    });
  };

  const close = () => {
    setDraft(EMPTY);
    change.reset();
    onClose();
  };

  const server = change.error ? describeError(change.error).message : null;
  const shown = (field: keyof Draft) => (touched ? check[field] : null);

  return (
    <Dialog open onOpenChange={(open) => (!open && !change.isPending ? close() : undefined)}>
      <DialogContent>
        <form className="grid gap-4" onSubmit={submit} noValidate>
          <DialogHeader>
            <DialogTitle>Change your password</DialogTitle>
            <DialogDescription>
              You stay signed in here; every other session of yours is signed out.
            </DialogDescription>
          </DialogHeader>
          <Field label="Current password" htmlFor="pw-current" error={shown('currentPassword')}>
            <Input
              id="pw-current"
              type="password"
              autoComplete="current-password"
              autoFocus
              value={draft.currentPassword}
              onChange={(e) => set('currentPassword')(e.target.value)}
            />
          </Field>
          <Field
            label="New password"
            htmlFor="pw-new"
            hint={`At least ${STAFF_PASSWORD_POLICY.minLength} characters. A short sentence you will remember works well.`}
            error={shown('newPassword')}
          >
            <Input
              id="pw-new"
              type="password"
              autoComplete="new-password"
              value={draft.newPassword}
              onChange={(e) => set('newPassword')(e.target.value)}
            />
          </Field>
          <Field label="New password, again" htmlFor="pw-confirm" error={shown('confirm')}>
            <Input
              id="pw-confirm"
              type="password"
              autoComplete="new-password"
              value={draft.confirm}
              onChange={(e) => set('confirm')(e.target.value)}
            />
          </Field>
          <Field label="Authenticator code" htmlFor="pw-code" error={shown('code')}>
            <Input
              id="pw-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={draft.code}
              onChange={(e) => set('code')(e.target.value)}
              className="font-mono tracking-micro"
            />
          </Field>
          {server ? (
            <p role="alert" className="text-destructive text-sm">
              {server}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close} disabled={change.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={change.isPending}>
              {change.isPending ? <Spinner /> : null}
              Change password
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
