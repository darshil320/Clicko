'use client';

import { useState } from 'react';
import { api } from '../../src/api';
import { type Session, saveSession } from '../../src/session';

export function Login({ onLogin }: { readonly onLogin: (s: Session) => void }) {
  const [phone, setPhone] = useState('+919876543210');
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function login() {
    setError(null);
    setStep('Requesting OTP…');
    const req = await api<{ challengeId: string }>('/auth/otp/request', {
      method: 'POST',
      body: JSON.stringify({ phone }),
    });
    if (!req.ok) return fail(req.error.message);
    setStep('Reading the dev OTP…');
    const otp = await api<{ code: string }>(`/dev/otp/${encodeURIComponent(phone)}`);
    if (!otp.ok) return fail('Dev OTP unavailable — is the API running with NODE_ENV=development?');
    setStep(`Verifying ${otp.data.code}…`);
    const verify = await api<{ accessToken: string }>('/auth/otp/verify', {
      method: 'POST',
      body: JSON.stringify({ challengeId: req.data.challengeId, phone, code: otp.data.code }),
    });
    if (!verify.ok) return fail(verify.error.message);
    const session = { accessToken: verify.data.accessToken, phone };
    saveSession(session);
    onLogin(session);
  }

  function fail(message: string) {
    setStep(null);
    setError(message);
  }

  return (
    <div className="card">
      <p className="muted">
        Step 1 · sign in as a customer. Uses the real OTP flow; the console reads the code from the
        dev-only endpoint instead of an SMS.
      </p>
      <div style={{ display: 'flex', gap: 12, alignItems: 'end' }}>
        <label>
          Customer phone
          <input value={phone} onChange={(e) => setPhone(e.target.value)} />
        </label>
        <button type="button" onClick={login} disabled={step !== null}>
          Sign in with OTP
        </button>
      </div>
      {step ? <p className="muted">{step}</p> : null}
      {error ? <p className="err">{error}</p> : null}
    </div>
  );
}
