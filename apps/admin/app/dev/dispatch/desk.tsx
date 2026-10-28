'use client';

import type { DispatchDeskView } from '@clickco/contracts';
import { formatINR } from '@clickco/utils';
import { useEffect, useState } from 'react';
import { api } from '../../../src/dev/api';

const OUTCOME_PILL: Record<string, string> = {
  ACCEPTED: 'ok',
  PENDING: 'warn',
  DECLINED: 'bad',
  EXPIRED: 'idle',
  LOST_RACE: 'idle',
  CANCELLED: 'idle',
};

/** Live dispatch rounds for one booking (dev-only endpoint), refreshed every 3 s. */
export function DispatchDesk({ bookingId }: { readonly bookingId: string }) {
  const [view, setView] = useState<DispatchDeskView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const r = await api<DispatchDeskView>(`/dev/dispatch/bookings/${bookingId}`);
      if (!alive) return;
      if (r.ok) {
        setView(r.data);
        setError(null);
      } else setError(r.error.message);
    };
    void load();
    const timer = setInterval(load, 3000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [bookingId]);

  if (error) return <p className="err">{error}</p>;
  if (!view) return <p className="muted">Loading dispatch…</p>;
  return (
    <div className="card">
      <p>
        Booking status <span className="pill warn">{view.bookingStatus}</span>
      </p>
      {view.rounds.length === 0 ? <p className="muted">No dispatch rounds yet.</p> : null}
      {view.rounds.map((round) => (
        <div key={round.roundId} style={{ marginBottom: 16 }}>
          <strong>
            Wave {round.wave}{' '}
            {round.isBroadcast ? '· emergency broadcast' : `· ${round.radiusKm} km`}
          </strong>{' '}
          <span className="muted">
            {round.candidateCount} offered · {round.windowSeconds}s window ·{' '}
            {round.outcome ?? 'OPEN'}
          </span>
          <table>
            <tbody>
              {round.attempts.map((a) => (
                <tr key={a.attemptId}>
                  <td>{a.photographerName}</td>
                  <td className="num">{a.distanceKm === null ? '—' : `${a.distanceKm} km`}</td>
                  <td className="num">score {a.rankScore?.toFixed(3) ?? '—'}</td>
                  <td className="num">{formatINR(a.offeredPayoutPaise)}</td>
                  <td>
                    <span className={`pill ${OUTCOME_PILL[a.outcome] ?? 'idle'}`}>{a.outcome}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      {view.assignments.map((a) => (
        <p key={a.assignmentId}>
          Assigned to <strong>{a.photographerName}</strong>{' '}
          <span className="pill ok">{a.status}</span>{' '}
          <span className="muted">
            calendar blocked {new Date(a.blockedFrom).toLocaleTimeString('en-IN')} –{' '}
            {new Date(a.blockedUntil).toLocaleTimeString('en-IN')}
          </span>
        </p>
      ))}
    </div>
  );
}
