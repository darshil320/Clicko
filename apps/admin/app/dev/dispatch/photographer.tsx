'use client';

import type { ProOffer, ProVerifyOtpResponse } from '@clickco/contracts';
import { formatINR } from '@clickco/utils';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../src/dev/api';
import { readDevOtp } from '../../../src/dev/dev-otp';

/** Act as a photographer: PRO_LOGIN OTP, see live offers (no address), accept or decline. */
export function PhotographerSim() {
  const [phone, setPhone] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [offers, setOffers] = useState<ProOffer[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  const auth = useCallback(
    (idempotent = false): Record<string, string> => ({
      authorization: `Bearer ${token}`,
      ...(idempotent ? { 'idempotency-key': crypto.randomUUID() } : {}),
    }),
    [token],
  );

  const loadOffers = useCallback(async () => {
    if (!token) return;
    const r = await api<ProOffer[]>('/pro/offers', { headers: auth() });
    if (r.ok) setOffers(r.data);
  }, [token, auth]);

  useEffect(() => {
    void loadOffers();
    const timer = setInterval(loadOffers, 3000);
    return () => clearInterval(timer);
  }, [loadOffers]);

  async function signIn() {
    setMessage('Signing in…');
    const req = await api<{ challengeId: string }>('/pro/auth/otp/request', {
      method: 'POST',
      body: JSON.stringify({ phone }),
    });
    if (!req.ok) return setMessage(req.error.message);
    const code = await readDevOtp(phone);
    if (!code) return setMessage('No OTP — is this an ACTIVE photographer from the dev seed?');
    const v = await api<ProVerifyOtpResponse>('/pro/auth/otp/verify', {
      method: 'POST',
      body: JSON.stringify({ challengeId: req.data.challengeId, phone, code }),
    });
    if (!v.ok) return setMessage(v.error.message);
    setToken(v.data.accessToken);
    setName(v.data.photographer.displayName);
    setMessage(null);
  }

  async function respond(attemptId: string, action: 'accept' | 'decline') {
    const r = await api(`/pro/offers/${attemptId}/${action}`, {
      method: 'POST',
      headers: auth(true),
      body: JSON.stringify(action === 'decline' ? { reason: 'Not available' } : {}),
    });
    setMessage(
      r.ok
        ? `${action === 'accept' ? 'Accepted' : 'Declined'}.`
        : `${r.error.code}: ${r.error.message}`,
    );
    await loadOffers();
  }

  return (
    <div className="card">
      {token ? (
        <p>
          Signed in as photographer <strong>{name}</strong>
        </p>
      ) : (
        <div style={{ display: 'flex', gap: 12, alignItems: 'end' }}>
          <label>
            Photographer phone (from the dev seed)
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91…" />
          </label>
          <button type="button" onClick={signIn}>
            Sign in as photographer
          </button>
        </div>
      )}
      {message ? <p className="muted">{message}</p> : null}
      {token && offers.length === 0 ? (
        <p className="muted">No live offers for this photographer.</p>
      ) : null}
      {offers.map((o) => (
        <div key={o.attemptId} className="card">
          <strong>{formatINR(o.payoutPaise)}</strong> payout · {o.tier} · {o.categoryCode} ·{' '}
          {new Date(o.scheduledStart).toLocaleString('en-IN')} · {o.area.areaName ?? o.area.pincode}
          , {o.area.cityName} {o.distanceKm === null ? '' : `· ${o.distanceKm} km`} · client{' '}
          {o.clientDisplayName}
          {o.isBroadcast ? <span className="pill warn"> EMERGENCY</span> : null}
          <p className="muted">
            Offer expires {new Date(o.expiresAt).toLocaleTimeString('en-IN')} · exact address after
            accepting
          </p>
          <div style={{ display: 'flex', gap: 12 }}>
            <button type="button" onClick={() => respond(o.attemptId, 'accept')}>
              Accept
            </button>
            <button type="button" onClick={() => respond(o.attemptId, 'decline')}>
              Decline
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
