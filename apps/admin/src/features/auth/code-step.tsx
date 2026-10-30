'use client';

import { isApiError } from '@clickco/api-client';
import type { StaffLoginChallenge, StaffSessionResponse } from '@clickco/contracts';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  CopyField,
  Field,
  Input,
  KeyRoundIcon,
  Spinner,
  toast,
} from '@clickco/ui-web';
import { type FormEvent, useState } from 'react';
import { adminApi } from '../../shared/api';
import { describeError } from '../../shared/errors';
import { formatTime } from '../../shared/format';

const CODE = /^\d{6}$/;

/**
 * Step 2 (ADR-0025 D2): the authenticator code. A first sign-in enrols TOTP first: the secret
 * and the otpauth URI are shown once, as text to copy (no QR library).
 */
export function CodeStep({
  challenge,
  newPassword,
  onSession,
  onRestart,
  onPasswordRejected,
}: {
  readonly challenge: StaffLoginChallenge;
  /** ADR-0026 D7: the password chosen in the step before, saved with this code. */
  readonly newPassword: string | null;
  readonly onSession: (session: StaffSessionResponse) => void;
  readonly onRestart: (message: string | null) => void;
  /** The server refused the chosen password: back to choosing one, with its reason. */
  readonly onPasswordRejected: (message: string) => void;
}) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const enrolling = challenge.step === 'ENROL_TOTP' && challenge.enrolment !== null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (Date.now() >= Date.parse(challenge.expiresAt)) {
      onRestart('That sign-in took too long. Start again.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onSession(
        await adminApi.auth.totp({
          challengeId: challenge.challengeId,
          code,
          ...(newPassword ? { newPassword } : {}),
        }),
      );
    } catch (failure) {
      if (isApiError(failure) && failure.code === 'PASSWORD_REJECTED') {
        onPasswordRejected(failure.message);
        return;
      }
      if (isApiError(failure) && failure.code === 'TEMPORARY_PASSWORD_EXPIRED') {
        onRestart(failure.message);
        return;
      }
      const message =
        failure instanceof Error && failure.message
          ? failure.message
          : describeError(failure).message;
      setError(message);
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="grid gap-4" onSubmit={submit} noValidate>
      {enrolling && challenge.enrolment ? (
        <Alert variant="info">
          <KeyRoundIcon />
          <AlertTitle>Set up your authenticator</AlertTitle>
          <AlertDescription>
            <p>
              Every Clickco staff account uses a 6-digit code from an authenticator app. Add this
              key to your app (Google Authenticator, Microsoft Authenticator, 1Password…). It is
              shown only now.
            </p>
            <div className="grid w-full gap-2 pt-1">
              <span className="font-medium text-xs uppercase tracking-micro">Setup key</span>
              <CopyField
                label="setup key"
                value={challenge.enrolment.secret}
                onCopyFailed={() => toast.error('Copy did not work — select the key instead')}
              />
              <span className="font-medium text-xs uppercase tracking-micro">Setup link</span>
              <CopyField
                label="setup link"
                value={challenge.enrolment.otpauthUri}
                onCopyFailed={() => toast.error('Copy did not work — select the link instead')}
              />
            </div>
          </AlertDescription>
        </Alert>
      ) : null}
      <Field
        label="Authenticator code"
        htmlFor="code"
        hint={`Six digits from your app. This step ends at ${formatTime(challenge.expiresAt)}.`}
        error={error}
      >
        <Input
          id="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          pattern="\d{6}"
          required
          autoFocus
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'code-error' : undefined}
          className="font-mono text-lg tracking-micro"
        />
      </Field>
      <Button type="submit" size="lg" disabled={busy || !CODE.test(code)}>
        {busy ? <Spinner /> : null}
        {busy ? 'Signing in…' : enrolling ? 'Finish setup and sign in' : 'Sign in'}
      </Button>
      <Button type="button" variant="ghost" onClick={() => onRestart(null)} disabled={busy}>
        Use a different account
      </Button>
    </form>
  );
}
