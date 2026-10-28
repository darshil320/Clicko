'use client';

import type { BookingDetail, PayBookingResponse } from '@clickco/contracts';
import { formatINR } from '@clickco/utils';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../src/api';
import { authHeaders, type Session } from '../../src/session';

const rupees = (p: number) => formatINR(p, { showPaise: p % 100 !== 0 });
const STATUS_PILL: Record<string, string> = {
  CONFIRMED: 'ok',
  QUOTED: 'idle',
  ADVANCE_PENDING: 'warn',
};

export function BookingPanel({
  session,
  bookingId,
}: {
  readonly session: Session;
  readonly bookingId: string;
}) {
  const [detail, setDetail] = useState<BookingDetail | null>(null);
  const [payment, setPayment] = useState<PayBookingResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const r = await api<BookingDetail>(`/bookings/${bookingId}`, { headers: authHeaders(session) });
    if (r.ok) setDetail(r.data);
    else setError(r.error.message);
  }, [bookingId, session]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function run<T>(
    fn: () => Promise<{ ok: boolean; data?: T; error?: { code: string; message: string } }>,
  ) {
    setBusy(true);
    setError(null);
    const r = await fn();
    setBusy(false);
    if (!r.ok) setError(`${r.error?.code}: ${r.error?.message}`);
    await refresh();
    return r;
  }

  const pay = () =>
    run(async () => {
      const r = await api<PayBookingResponse>(`/bookings/${bookingId}/pay`, {
        method: 'POST',
        headers: authHeaders(session, true),
      });
      if (r.ok) setPayment(r.data);
      return r;
    });

  const simulate = (outcome: 'CAPTURED' | 'FAILED') =>
    run(() =>
      api(`/dev/payments/${payment?.paymentId}/simulate`, {
        method: 'POST',
        body: JSON.stringify({ outcome }),
      }),
    );

  const cancel = () =>
    run(() =>
      api(`/bookings/${bookingId}/cancel`, { method: 'POST', headers: authHeaders(session, true) }),
    );

  if (!detail) return <div className="card">{error ?? 'Loading booking…'}</div>;
  const b = detail.booking;
  return (
    <div className="card">
      <p>
        <strong>{b.reference}</strong>{' '}
        <span className={`pill ${STATUS_PILL[b.status] ?? 'idle'}`}>{b.status}</span>{' '}
        <span className="muted">
          {b.tier} · {b.categoryCode} · {b.cityName} ·{' '}
          {new Date(b.scheduledStart).toLocaleString('en-IN')}
        </span>
      </p>
      <p className="muted">
        Total {rupees(b.totalPaise)} · advance {rupees(b.advancePaise)} · balance{' '}
        {rupees(b.balancePaise)} · paid {rupees(b.amountPaidPaise)}
      </p>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', margin: '12px 0' }}>
        {b.status === 'QUOTED' ? (
          <button type="button" onClick={pay} disabled={busy}>
            Step 3 · Pay advance {rupees(b.advancePaise)}
          </button>
        ) : null}
        {b.status === 'ADVANCE_PENDING' && payment ? (
          <>
            <button type="button" onClick={() => simulate('CAPTURED')} disabled={busy}>
              Step 4 · Simulate payment success
            </button>
            <button type="button" onClick={() => simulate('FAILED')} disabled={busy}>
              Simulate failure
            </button>
          </>
        ) : null}
        {b.status === 'QUOTED' || b.status === 'ADVANCE_PENDING' ? (
          <button type="button" onClick={cancel} disabled={busy}>
            Cancel booking
          </button>
        ) : null}
      </div>
      {payment ? (
        <p className="muted">
          Payment {payment.gateway} order <code>{payment.providerOrderId}</code> ·{' '}
          {rupees(payment.amountPaise)}
          {payment.authorizeOnly ? ' · authorise only (captured when a photographer accepts)' : ''}
        </p>
      ) : null}
      {error ? <p className="err">{error}</p> : null}
      {['CONFIRMED', 'DISPATCHING', 'ASSIGNED'].includes(b.status) ? (
        <p>
          <a href={`/dispatch?booking=${b.id}`}>Open in the dispatch desk →</a>
        </p>
      ) : null}

      <h2>Timeline</h2>
      <table>
        <tbody>
          {detail.timeline.map((t) => (
            <tr key={`${t.toStatus}-${t.occurredAt}`}>
              <td>{new Date(t.occurredAt).toLocaleTimeString('en-IN')}</td>
              <td>
                {t.fromStatus ?? '—'} → <strong>{t.toStatus}</strong>
              </td>
              <td className="muted">
                {t.actorKind}
                {t.reason ? ` · ${t.reason}` : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Tax invoices</h2>
      {detail.invoices.length === 0 ? (
        <p className="muted">None yet — issued when the advance is captured.</p>
      ) : (
        <table>
          <tbody>
            {detail.invoices.map((i) => (
              <tr key={i.invoiceNumber}>
                <td>
                  <code>{i.invoiceNumber}</code> {i.purpose}
                </td>
                <td className="num">taxable {rupees(i.taxablePaise)}</td>
                <td className="num">
                  {i.igstPaise > 0
                    ? `IGST ${rupees(i.igstPaise)}`
                    : `CGST ${rupees(i.cgstPaise)} + SGST ${rupees(i.sgstPaise)}`}
                </td>
                <td className="num">
                  <strong>{rupees(i.totalPaise)}</strong>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
