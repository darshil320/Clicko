'use client';

import type { QuoteResponse } from '@clickco/contracts';
import { formatINR } from '@clickco/utils';
import { useState } from 'react';
import { api } from '../../src/api';

const TIERS = ['BASIC', 'SEMI_PRO', 'PROFESSIONAL', 'EXPERT', 'SIGNATURE'] as const;
const CATEGORIES = [
  'PORTRAIT',
  'EVENT',
  'FOOD',
  'PRODUCT',
  'REAL_ESTATE',
  'CORPORATE',
  'WEDDING',
] as const;
const ADDONS = ['SECOND_SHOOTER', 'DRONE', 'LIGHTING_KIT', 'RUSH_24H'] as const;

const BAND_LABEL: Record<string, string> = {
  NONE: 'STANDARD (>48H)',
  NEXT_DAY: 'NEXT DAY ×1.2',
  SAME_DAY: 'SAME DAY ×1.4 · PAY 100%',
  HOURS_3_8: '3–8 HOURS ×1.8 · PAY 100%',
  HOURS_UNDER_3: 'UNDER 3 HOURS ×2.2 · BEST EFFORT',
};

/** Local datetime-local value N days from now at 4:30 pm. */
function defaultStart(): string {
  const d = new Date(Date.now() + 5 * 86_400_000);
  d.setHours(16, 30, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const rupees = (paise: number) => formatINR(paise, { showPaise: paise % 100 !== 0 });

export default function QuoteCalculator() {
  const [form, setForm] = useState({
    tier: 'PROFESSIONAL',
    categoryCode: 'FOOD',
    pincode: '395007',
    start: defaultStart(),
    hours: '2',
    distanceKm: '',
    promoCode: '',
  });
  const [addons, setAddons] = useState<string[]>([]);
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set =
    (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm({ ...form, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const r = await api<QuoteResponse>('/pricing/quote', {
      method: 'POST',
      body: JSON.stringify({
        tier: form.tier,
        categoryCode: form.categoryCode,
        pincode: form.pincode,
        scheduledStart: new Date(form.start).toISOString(),
        hours: Number(form.hours),
        addons: addons.map((code) => ({ code, quantity: 1 })),
        ...(form.distanceKm ? { travelDistanceKm: Number(form.distanceKm) } : {}),
        ...(form.promoCode ? { promoCode: form.promoCode } : {}),
      }),
    });
    setBusy(false);
    setQuote(r.ok ? r.data : null);
    setError(r.ok ? null : `${r.error.code}: ${r.error.message}`);
  }

  return (
    <>
      <h1>Quote calculator</h1>
      <p className="muted">
        Live against the published ruleset. Same engine the app will use — try a same-day start
        (emergency pricing), 11 pm (night), a Saturday, Diwali week, or 18 km (travel zone 1).
      </p>
      <form className="card" onSubmit={submit}>
        <div className="grid">
          <label>
            Tier
            <select value={form.tier} onChange={set('tier')}>
              {TIERS.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          <label>
            Category
            <select value={form.categoryCode} onChange={set('categoryCode')}>
              {CATEGORIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label>
            Venue pincode
            <input value={form.pincode} onChange={set('pincode')} maxLength={6} />
          </label>
          <label>
            Start (your local time)
            <input type="datetime-local" value={form.start} onChange={set('start')} />
          </label>
          <label>
            Hours
            <input type="number" min={2} step={0.5} value={form.hours} onChange={set('hours')} />
          </label>
          <label>
            Distance km (optional)
            <input
              type="number"
              min={0}
              step={0.01}
              value={form.distanceKm}
              onChange={set('distanceKm')}
            />
          </label>
          <label>
            Promo code (optional)
            <input value={form.promoCode} onChange={set('promoCode')} />
          </label>
        </div>
        <p className="muted">Add-ons</p>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
          {ADDONS.map((a) => (
            <label key={a} style={{ flexDirection: 'row', alignItems: 'center' }}>
              <input
                type="checkbox"
                style={{ height: 16 }}
                checked={addons.includes(a)}
                onChange={(e) =>
                  setAddons(e.target.checked ? [...addons, a] : addons.filter((x) => x !== a))
                }
              />
              {a}
            </label>
          ))}
        </div>
        <button type="submit" disabled={busy}>
          Get quote
        </button>
      </form>

      {error ? <p className="err">{error}</p> : null}
      {quote?.kind === 'QUOTE_ONLY' ? (
        <div className="card">Signature is quote-only: enquiry → ops call → custom quote.</div>
      ) : null}
      {quote?.kind === 'QUOTE' ? (
        <div className="card">
          <p>
            <span className={`pill ${quote.emergencyBand === 'NONE' ? 'ok' : 'warn'}`}>
              {BAND_LABEL[quote.emergencyBand] ?? quote.emergencyBand}
            </span>{' '}
            {quote.isPeakSeason ? <span className="pill warn">PEAK SEASON</span> : null}{' '}
            {quote.captureOnAcceptOnly ? <span className="pill warn">AUTHORISE ONLY</span> : null}{' '}
            {quote.airspaceCheckRequired ? <span className="pill idle">AIRSPACE CHECK</span> : null}{' '}
            <span className="muted">
              ruleset {quote.rulesetVersion} · {quote.cityTier} · zone {quote.travelZone}
            </span>
          </p>
          <table>
            <tbody>
              {quote.lines.map((l) => (
                <tr key={`${l.code}-${l.label}`}>
                  <td>
                    {l.label} {l.detail ? <span className="muted">· {l.detail}</span> : null}
                  </td>
                  <td className="num">
                    {l.isFactor
                      ? `× ${((l.factorBps ?? 10000) / 10000).toFixed(2)}`
                      : rupees(l.amountPaise ?? 0)}
                  </td>
                </tr>
              ))}
              <tr>
                <td>Subtotal</td>
                <td className="num">{rupees(quote.subtotalPaise)}</td>
              </tr>
              {quote.discountPaise > 0 ? (
                <tr>
                  <td>Discount</td>
                  <td className="num">−{rupees(quote.discountPaise)}</td>
                </tr>
              ) : null}
              <tr>
                <td>
                  GST {quote.gst.rateBps / 100}%{' '}
                  <span className="muted">
                    · {quote.gst.igstPaise > 0 ? 'IGST' : 'CGST + SGST'} · place of supply{' '}
                    {quote.gst.placeOfSupply}
                  </span>
                </td>
                <td className="num">
                  {rupees(quote.gst.cgstPaise + quote.gst.sgstPaise + quote.gst.igstPaise)}
                </td>
              </tr>
              <tr className="total">
                <td>Total</td>
                <td className="num">{rupees(quote.totalPaise)}</td>
              </tr>
              <tr>
                <td>Pay now (advance)</td>
                <td className="num">{rupees(quote.advancePaise)}</td>
              </tr>
              <tr>
                <td className="muted">Balance after the shoot</td>
                <td className="num muted">{rupees(quote.balancePaise)}</td>
              </tr>
            </tbody>
          </table>
          <p className="muted">
            Quote valid until {new Date(quote.quoteExpiresAt).toLocaleTimeString('en-IN')}.
          </p>
        </div>
      ) : null}
    </>
  );
}
