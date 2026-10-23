'use client';

import { DevOtpResponse, newIdempotencyKey } from '@clickco/api-client';
import { PhoneE164, ProVerifyOtpResponse, RequestOtpResponse } from '@clickco/contracts';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { api, errorMessage } from '../../shared/api';
import { saveSession } from '../../shared/session';

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

  return (
    <div className="card stack narrow">
      <h1>Photographer sign-in</h1>
      <p className="muted small">
        Use the mobile number registered with Clickco. We send a 6-digit code by SMS.
      </p>
      {challengeId === null ? (
        <form className="stack" onSubmit={requestCode}>
          <label>
            Mobile number
            <input
              name="phone"
              inputMode="tel"
              autoComplete="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value.trim())}
            />
          </label>
          <button type="submit" disabled={busy}>
            {busy ? 'Sending…' : 'Send code'}
          </button>
        </form>
      ) : (
        <form className="stack" onSubmit={verify}>
          <label>
            6-digit code sent to {phone}
            <input
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            />
          </label>
          <button type="submit" disabled={busy || code.length !== 6}>
            {busy ? 'Checking…' : 'Sign in'}
          </button>
          {DEV ? (
            <button type="button" className="secondary" onClick={fillDevOtp} disabled={busy}>
              Fill dev OTP
            </button>
          ) : null}
          <button type="button" className="link" onClick={() => setChallengeId(null)}>
            Use a different number
          </button>
        </form>
      )}
      {error ? (
        <p className="err small" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
