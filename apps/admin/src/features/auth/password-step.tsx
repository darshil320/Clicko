'use client';

import type { StaffLoginChallenge } from '@clickco/contracts';
import { Button, Field, Input, Spinner } from '@clickco/ui-web';
import { type FormEvent, useState } from 'react';
import { adminApi } from '../../shared/api';
import { describeError } from '../../shared/errors';

/** Step 1 (ADR-0025 D2): email + password. Every failure reads the same (no enumeration). */
export function PasswordStep({
  onChallenge,
}: {
  readonly onChallenge: (challenge: StaffLoginChallenge) => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onChallenge(await adminApi.auth.login({ email, password }));
    } catch (failure) {
      // A 401 here is a wrong email or password, not an ended session: show the server's words.
      const message =
        failure instanceof Error && failure.message
          ? failure.message
          : describeError(failure).message;
      setError(message);
      setPassword('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="grid gap-4" onSubmit={submit} noValidate>
      <Field label="Work email" htmlFor="email">
        <Input
          id="email"
          type="email"
          autoComplete="username"
          inputMode="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={error ? true : undefined}
        />
      </Field>
      <Field label="Password" htmlFor="password" error={error}>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'password-error' : undefined}
        />
      </Field>
      <Button type="submit" size="lg" disabled={busy || !email || !password}>
        {busy ? <Spinner /> : null}
        {busy ? 'Checking…' : 'Continue'}
      </Button>
    </form>
  );
}
