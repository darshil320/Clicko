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
import { PasswordStep } from './password-step';

const REASONS: Readonly<Record<string, string>> = {
  idle: 'You were signed out after 30 minutes without activity.',
  expired: 'Your session ended. Sign in again to carry on.',
};

const safeNextHere = (next: string | null): string | null => safeNext(next, window.location.origin);

/** Staff sign-in (ADR-0025 D2): password → TOTP, or TOTP enrolment on the first sign-in. */
export function SignIn() {
  const router = useRouter();
  const params = useSearchParams();
  const hydrated = useHydrated();
  const [challenge, setChallenge] = useState<StaffLoginChallenge | null>(null);
  const [notice, setNotice] = useState<string | null>(REASONS[params.get('reason') ?? ''] ?? null);
  const next = safeNextHere(params.get('next'));

  // Already signed in in this tab: go straight in.
  useEffect(() => {
    if (!hydrated) return;
    const session = loadSession();
    if (session) router.replace(next ?? homeFor(session.staff.grants) ?? '/');
  }, [hydrated, next, router]);

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
            <CardTitle>{challenge ? 'Confirm it’s you' : 'Sign in'}</CardTitle>
            <CardDescription>
              {challenge
                ? 'Enter the code from your authenticator app.'
                : 'Staff only. Accounts are created by a super admin.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {notice ? (
              <Alert variant="warning">
                <ShieldCheckIcon />
                <AlertDescription>{notice}</AlertDescription>
              </Alert>
            ) : null}
            {challenge ? (
              <CodeStep
                challenge={challenge}
                onSession={onSession}
                onRestart={(message) => {
                  setChallenge(null);
                  setNotice(message);
                }}
              />
            ) : (
              <PasswordStep
                onChallenge={(c) => {
                  setNotice(null);
                  setChallenge(c);
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
