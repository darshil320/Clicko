'use client';

import type { StaffLoginChallenge, StaffSessionResponse } from '@clickco/contracts';
import {
  Alert,
  AlertDescription,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ShieldCheckIcon,
} from '@clickco/ui-web';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { homeFor } from '../../shared/access';
import { safeNext } from '../../shared/safe-next';
import { loadSession, recordActivity, saveSession, useHydrated } from '../../shared/session';
import { CodeStep } from './code-step';
import { NewPasswordStep } from './new-password-step';
import { PasswordStep } from './password-step';

/** Where the sign-in is: the password, then (temporary password only) a new one, then the code. */
type Step =
  | { readonly kind: 'password' }
  | {
      readonly kind: 'new-password';
      readonly challenge: StaffLoginChallenge;
      readonly email: string;
      readonly temporaryPassword: string;
      readonly rejected: string | null;
    }
  | {
      readonly kind: 'code';
      readonly challenge: StaffLoginChallenge;
      readonly email: string;
      readonly temporaryPassword: string | null;
      readonly newPassword: string | null;
    };

const TITLES = {
  password: ['Sign in', 'Staff only. Accounts are created by a super admin.'],
  'new-password': ['Choose your password', 'One more step before your first sign-in.'],
  code: ['Confirm it’s you', 'Enter the code from your authenticator app.'],
} as const;

const REASONS: Readonly<Record<string, string>> = {
  idle: 'You were signed out after 30 minutes without activity.',
  expired: 'Your session ended. Sign in again to carry on.',
};

const safeNextHere = (next: string | null): string | null => safeNext(next, window.location.origin);

/**
 * Staff sign-in (ADR-0025 D2): password → TOTP, or TOTP enrolment on the first sign-in.
 * ADR-0026 D7: a temporary password first asks for a new one, sent with the code.
 */
export function SignIn() {
  const router = useRouter();
  const params = useSearchParams();
  const hydrated = useHydrated();
  const [step, setStep] = useState<Step>({ kind: 'password' });
  const [notice, setNotice] = useState<string | null>(REASONS[params.get('reason') ?? ''] ?? null);
  const next = safeNextHere(params.get('next'));

  // Already signed in in this tab: go straight in.
  useEffect(() => {
    if (!hydrated) return;
    const session = loadSession();
    if (session) router.replace(next ?? homeFor(session.staff.grants) ?? '/');
  }, [hydrated, next, router]);

  /** Back to the password; the typed passwords are dropped with the step. */
  const restart = (message: string | null) => {
    setStep({ kind: 'password' });
    setNotice(message);
  };

  const onSession = (session: StaffSessionResponse) => {
    saveSession({
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      staff: session.staff,
    });
    recordActivity(Date.now());
    router.replace(next ?? homeFor(session.staff.grants) ?? '/');
  };

  return (
    <div className="flex min-h-svh items-center justify-center bg-background px-4 py-10">
      <div className="grid w-full max-w-md gap-4">
        <div className="flex items-center gap-2 font-bold font-display text-xl">
          <span aria-hidden="true" className="size-3 rounded-full bg-primary" />
          Clickco Admin
        </div>
        <Card>
          <CardHeader>
            <CardTitle>{TITLES[step.kind][0]}</CardTitle>
            <CardDescription>{TITLES[step.kind][1]}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {notice ? (
              <Alert variant="warning">
                <ShieldCheckIcon />
                <AlertDescription>{notice}</AlertDescription>
              </Alert>
            ) : null}
            {step.kind === 'code' ? (
              <CodeStep
                challenge={step.challenge}
                newPassword={step.newPassword}
                onSession={onSession}
                onRestart={restart}
                onPasswordRejected={(message) =>
                  setStep({
                    kind: 'new-password',
                    challenge: step.challenge,
                    email: step.email,
                    temporaryPassword: step.temporaryPassword ?? '',
                    rejected: message,
                  })
                }
              />
            ) : step.kind === 'new-password' ? (
              <NewPasswordStep
                email={step.email}
                temporaryPassword={step.temporaryPassword}
                serverError={step.rejected}
                onChosen={(newPassword) =>
                  setStep({
                    kind: 'code',
                    challenge: step.challenge,
                    email: step.email,
                    temporaryPassword: step.temporaryPassword,
                    newPassword,
                  })
                }
                onRestart={() => restart(null)}
              />
            ) : (
              <PasswordStep
                onChallenge={(challenge, email, password) => {
                  setNotice(null);
                  setStep(
                    challenge.mustChangePassword
                      ? {
                          kind: 'new-password',
                          challenge,
                          email,
                          temporaryPassword: password,
                          rejected: null,
                        }
                      : {
                          kind: 'code',
                          challenge,
                          email,
                          temporaryPassword: null,
                          newPassword: null,
                        },
                  );
                }}
              />
            )}
          </CardContent>
        </Card>
        <p className="text-center text-muted-foreground text-sm">
          The session stays in this tab only and ends after 30 minutes without activity.
        </p>
      </div>
    </div>
  );
}
