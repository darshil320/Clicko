'use client';

import { STAFF_PASSWORD_POLICY, staffPasswordProblem } from '@clickco/contracts';
import { Alert, AlertDescription, Button, Field, Input, LockKeyholeIcon } from '@clickco/ui-web';
import { type FormEvent, useState } from 'react';

/**
 * ADR-0026 D7, between the password and the code: the account still has its temporary
 * password, so the person chooses their own (12+ characters, not the email, not the temporary
 * one). It is checked here for a quick answer, and again by the server, which saves it in the
 * same step that checks the authenticator code.
 */
export function NewPasswordStep({
  email,
  temporaryPassword,
  serverError,
  onChosen,
  onRestart,
}: {
  readonly email: string;
  readonly temporaryPassword: string;
  /** The server refused the last choice (e.g. it was the temporary password). */
  readonly serverError: string | null;
  readonly onChosen: (newPassword: string) => void;
  readonly onRestart: () => void;
}) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [touched, setTouched] = useState(false);
  const problem = staffPasswordProblem(password, { email, previous: temporaryPassword });
  const mismatch = confirm !== password ? 'The two passwords don’t match' : null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (!problem && !mismatch) onChosen(password);
  };

  return (
    <form className="grid gap-4" onSubmit={submit} noValidate>
      <Alert variant="info">
        <LockKeyholeIcon />
        <AlertDescription>
          <p>
            You signed in with a temporary password. Choose your own to finish — only you will know
            it.
          </p>
        </AlertDescription>
      </Alert>
      <Field
        label="New password"
        htmlFor="new-password"
        hint={`At least ${STAFF_PASSWORD_POLICY.minLength} characters. A short sentence you will remember works well.`}
        error={touched ? (problem ?? serverError) : serverError}
      >
        <Input
          id="new-password"
          type="password"
          autoComplete="new-password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-invalid={touched && problem ? true : undefined}
        />
      </Field>
      <Field
        label="New password, again"
        htmlFor="new-password-again"
        error={touched ? mismatch : null}
      >
        <Input
          id="new-password-again"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          aria-invalid={touched && mismatch ? true : undefined}
        />
      </Field>
      <Button type="submit" size="lg">
        Continue
      </Button>
      <Button type="button" variant="ghost" onClick={onRestart}>
        Use a different account
      </Button>
    </form>
  );
}
