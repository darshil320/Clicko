'use client';

import { useEffect, useState } from 'react';
import { API_URL, api } from '../../src/dev/api';

interface Check {
  readonly name: string;
  readonly run: () => Promise<{ ok: boolean; detail: string }>;
}

const CHECKS: readonly Check[] = [
  {
    name: 'API + database',
    run: async () => {
      const r = await api<{ status: string; database: string }>('/health');
      return { ok: r.ok, detail: r.ok ? `database ${r.data.database}` : r.error.message };
    },
  },
  {
    name: 'Pincode gate (395007 Surat)',
    run: async () => {
      const r = await api<{ bookable: boolean; status: string }>('/serviceability/395007');
      return { ok: r.ok && r.data.bookable, detail: r.ok ? r.data.status : r.error.message };
    },
  },
  {
    name: 'Pricing engine (sample quote)',
    run: async () => {
      const start = new Date(Date.now() + 5 * 24 * 3600 * 1000).toISOString();
      const r = await api<{ kind: string; totalPaise: number }>('/pricing/quote', {
        method: 'POST',
        body: JSON.stringify({
          tier: 'PROFESSIONAL',
          categoryCode: 'FOOD',
          pincode: '395007',
          scheduledStart: start,
          hours: 2,
        }),
      });
      return {
        ok: r.ok,
        detail: r.ok
          ? `total ₹${(r.data.totalPaise / 100).toLocaleString('en-IN')}`
          : r.error.message,
      };
    },
  },
];

type Result = { ok: boolean; detail: string } | null;

export function StatusChecks() {
  const [results, setResults] = useState<Result[]>(CHECKS.map(() => null));

  useEffect(() => {
    CHECKS.forEach((check, i) => {
      check.run().then((r) => setResults((prev) => prev.map((p, j) => (j === i ? r : p))));
    });
  }, []);

  return (
    <div className="card">
      <table>
        <tbody>
          {CHECKS.map((c, i) => {
            const r = results[i];
            return (
              <tr key={c.name}>
                <td>{c.name}</td>
                <td>
                  <span className={`pill ${r === null ? 'idle' : r?.ok ? 'ok' : 'bad'}`}>
                    {r === null ? 'CHECKING' : r?.ok ? 'LIVE' : 'DOWN'}
                  </span>
                </td>
                <td className="muted">{r?.detail ?? ''}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="muted">
        API: <code>{API_URL}</code>
      </p>
    </div>
  );
}
