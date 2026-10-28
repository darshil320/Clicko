'use client';

import type { ServiceabilityResult } from '@clickco/contracts';
import { useState } from 'react';
import { api } from '../../../src/dev/api';

export default function PincodeChecker() {
  const [pincode, setPincode] = useState('395007');
  const [result, setResult] = useState<ServiceabilityResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function check(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const r = await api<ServiceabilityResult>(`/serviceability/${encodeURIComponent(pincode)}`);
    setBusy(false);
    setResult(r.ok ? r.data : null);
    setError(r.ok ? null : r.error.message);
  }

  return (
    <>
      <h1>Pincode checker</h1>
      <p className="muted">
        The gate every booking passes first. Try 395007 (Surat), 400050 (Mumbai), 390007 (Vadodara,
        pilot), 600001 (Chennai, waitlist).
      </p>
      <form
        className="card"
        onSubmit={check}
        style={{ display: 'flex', gap: 12, alignItems: 'end' }}
      >
        <label>
          Pincode
          <input value={pincode} onChange={(e) => setPincode(e.target.value)} maxLength={6} />
        </label>
        <button type="submit" disabled={busy}>
          Check
        </button>
      </form>
      {error ? <p className="err">{error}</p> : null}
      {result ? (
        <div className="card">
          {result.bookable ? (
            <>
              <span className={`pill ${result.limitedAvailability ? 'warn' : 'ok'}`}>
                {result.status}
              </span>{' '}
              <strong>
                {result.city.name} · {result.city.tier}
              </strong>
              <p className="muted">
                Bookable · travel zone {result.travelZone}
                {result.limitedAvailability ? ' · limited availability (pilot)' : ''}
              </p>
            </>
          ) : (
            <>
              <span className={`pill ${result.canJoinWaitlist ? 'idle' : 'bad'}`}>
                {result.status}
              </span>{' '}
              <strong>{result.cityName ?? 'Unknown area'}</strong>
              <p className="muted">
                Not bookable ·{' '}
                {result.canJoinWaitlist
                  ? `${result.waitingCount} people on the waitlist`
                  : 'cannot be served'}
              </p>
            </>
          )}
        </div>
      ) : null}
    </>
  );
}
