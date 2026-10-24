'use client';

import { DevOtpResponse, newIdempotencyKey } from '@clickco/api-client';
import { PhoneE164, ProVerifyOtpResponse, RequestOtpResponse } from '@clickco/contracts';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { api, errorMessage } from '../../shared/api';
import { Icon } from '../../shared/icons';
import { saveSession } from '../../shared/session';
import { Callout } from '../../shared/ui';

/** Development only: Next inlines NODE_ENV, so the helper does not exist in a production build. */
const DEV = process.env.NODE_ENV === 'development';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** SMS goes out from a background job (ADR-0012 D8): poll the dev peek for ~5 s. */
async function readDevOtp(phone: string): Promise<string | null> {
  for (let i = 0; i < 10; i++) {
    try {
      const r = await api({
        method: 'GET',
        path: `/dev/otp/${encodeURIComponent(phone)}`,
        schema: DevOtpResponse,
      });
      return r.code;
    } catch {
      await sleep(500);
    }
  }
  return null;
}

/** Phone OTP sign-in, the same PRO_LOGIN as the Pro app (doc 02 §7 login). */
export function SignIn() {
  const router = useRouter();
  const [phone, setPhone] = useState('+91');
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestCode = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!PhoneE164.safeParse(phone).success) {
      setError('Enter your mobile number as +91 followed by 10 digits');
      return;
    }
    setBusy(true);
    try {
      const r = await api({
        method: 'POST',
        path: '/pro/auth/otp/request',
        schema: RequestOtpResponse,
        json: { phone },
      });
      setChallengeId(r.challengeId);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const verify = async (e: FormEvent) => {
    e.preventDefault();
    if (!challengeId) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api({
        method: 'POST',
        path: '/pro/auth/otp/verify',
        schema: ProVerifyOtpResponse,
        json: { challengeId, phone, code, deviceId: `portal-${newIdempotencyKey()}` },
      });
      saveSession({
        accessToken: r.accessToken,
        refreshToken: r.refreshToken,
        photographer: r.photographer,
      });
      router.replace('/jobs');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const fillDevOtp = async () => {
    setBusy(true);
    const found = await readDevOtp(phone);
    setBusy(false);
    if (found) setCode(found);
    else setError('No development OTP found yet — request a code first');
  };

  const step = challengeId === null ? 1 : 2;
  return (
    <section className="auth">
      <div className="auth-bg dots fade-mask" aria-hidden="true" />
      <div className="auth-card reveal">
        <span className="tile lg accent">
          <Icon name="camera" size="lg" />
        </span>
        <div className="auth-head">
          <div className="steps" aria-hidden="true">
            <span className="on" />
            <span className={step === 2 ? 'on' : undefined} />
          </div>
          <span className="eyebrow">
            Step {step} of 2 · {step === 1 ? 'Mobile number' : 'Verify'}
          </span>
          <h1>{step === 1 ? 'Photographer sign-in' : 'Enter your code'}</h1>
          <p className="muted">
            {step === 1
              ? 'Use the mobile number registered with Clickco. We send a 6-digit code by SMS.'
              : `We sent a 6-digit code by SMS to ${phone}.`}
          </p>
        </div>
        {challengeId === null ? (
          <form className="stack loose" onSubmit={requestCode}>
            <label className="field">
              Mobile number
              <input
                name="phone"
                inputMode="tel"
                autoComplete="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value.trim())}
              />
              <span className="hint">+91 followed by your 10-digit number</span>
            </label>
            <button type="submit" className="block" disabled={busy}>
              {busy ? 'Sending…' : 'Send code'}
              {busy ? null : <Icon name="forward" size="sm" />}
            </button>
          </form>
        ) : (
          <form className="stack loose" onSubmit={verify}>
            <label className="field">
              6-digit code
              <input
                name="code"
                className="otp"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              />
            </label>
            <div className="stack">
              <button type="submit" className="block" disabled={busy || code.length !== 6}>
                {busy ? 'Checking…' : 'Sign in'}
              </button>
              {DEV ? (
                <button
                  type="button"
                  className="secondary block"
                  onClick={fillDevOtp}
                  disabled={busy}
                >
                  Fill dev OTP
                </button>
              ) : null}
              <button type="button" className="ghost block" onClick={() => setChallengeId(null)}>
                Use a different number
              </button>
            </div>
          </form>
        )}
        {error ? (
          <div className="auth-error">
            <Callout tone="bad" alert>
              {error}
            </Callout>
          </div>
        ) : null}
        <p className="auth-foot">
          <Icon name="shield" size="sm" />
          <span>
            You stay signed in only while this tab is open. An unfinished upload resumes after you
            sign in again.
          </span>
        </p>
      </div>
    </section>
  );
}
