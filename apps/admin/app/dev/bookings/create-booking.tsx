'use client';

import type { CreateBookingResponse } from '@clickco/contracts';
import { useState } from 'react';
import { api } from '../../../src/dev/api';
import { authHeaders, type Session } from '../../../src/dev/session';

function defaultStart(): string {
  const d = new Date(Date.now() + 5 * 86_400_000);
  d.setHours(16, 30, 0, 0);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function CreateBooking({
  session,
  onCreated,
}: {
  readonly session: Session;
  readonly onCreated: (bookingId: string) => void;
}) {
  const [f, setF] = useState({
    tier: 'PROFESSIONAL',
    categoryCode: 'FOOD',
    pincode: '395007',
    start: defaultStart(),
    hours: '2',
    venueAddress: '14, Rajhans Platinum, Vesu, Surat',
    bookerName: 'Priya Sharma',
  });
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF({ ...f, [k]: e.target.value });

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const r = await api<CreateBookingResponse>('/bookings', {
      method: 'POST',
      headers: authHeaders(session, true),
      body: JSON.stringify({
        tier: f.tier,
        categoryCode: f.categoryCode,
        pincode: f.pincode,
        scheduledStart: new Date(f.start).toISOString(),
        hours: Number(f.hours),
        venueAddress: f.venueAddress,
        booker: { name: f.bookerName, phone: session.phone },
        modelReleaseConsent: consent,
        acceptedTermsVersion: 'v2-draft',
      }),
    });
    setBusy(false);
    if (r.ok) onCreated(r.data.booking.id);
    else setError(`${r.error.code}: ${r.error.message}`);
  }

  return (
    <form className="card" onSubmit={create}>
      <p className="muted">
        Step 2 · create a booking. The server re-prices it and freezes an immutable price snapshot.
      </p>
      <div className="grid">
        <label>
          Tier
          <select value={f.tier} onChange={set('tier')}>
            {['BASIC', 'SEMI_PRO', 'PROFESSIONAL', 'EXPERT'].map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <label>
          Category
          <select value={f.categoryCode} onChange={set('categoryCode')}>
            {['PORTRAIT', 'EVENT', 'FOOD', 'PRODUCT', 'REAL_ESTATE', 'CORPORATE', 'WEDDING'].map(
              (c) => (
                <option key={c}>{c}</option>
              ),
            )}
          </select>
        </label>
        <label>
          Pincode
          <input value={f.pincode} onChange={set('pincode')} />
        </label>
        <label>
          Start
          <input type="datetime-local" value={f.start} onChange={set('start')} />
        </label>
        <label>
          Hours
          <input type="number" min={2} step={0.5} value={f.hours} onChange={set('hours')} />
        </label>
        <label>
          Booker name
          <input value={f.bookerName} onChange={set('bookerName')} />
        </label>
      </div>
      <label style={{ marginTop: 12 }}>
        Venue address
        <input value={f.venueAddress} onChange={set('venueAddress')} />
      </label>
      <label style={{ flexDirection: 'row', alignItems: 'center', margin: '12px 0' }}>
        <input
          type="checkbox"
          style={{ height: 16 }}
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
        />
        Model release consent (opt-in, never pre-ticked)
      </label>
      <button type="submit" disabled={busy}>
        Create booking
      </button>
      {error ? <p className="err">{error}</p> : null}
    </form>
  );
}
