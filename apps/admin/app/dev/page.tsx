import { ROADMAP, type SprintState, WAITING_ON_OWNER } from '../../src/dev/roadmap';
import { StatusChecks } from './status-checks';

const PILL: Record<SprintState, string> = {
  done: 'ok',
  'in-progress': 'warn',
  next: 'idle',
  planned: 'idle',
  blocked: 'bad',
};

export default function Home() {
  const done = ROADMAP.filter((s) => s.state === 'done').length;
  return (
    <>
      <h1>Build status</h1>
      <p className="muted">
        On-demand photography for India · launch target 1 Feb 2027 (Surat) · {done} of{' '}
        {ROADMAP.length} sprints done
      </p>

      <h2>Live system</h2>
      <StatusChecks />

      <h2>Roadmap</h2>
      {ROADMAP.map((s) => (
        <div className="card" key={s.id}>
          <strong>
            {s.id} · {s.title}
          </strong>{' '}
          <span className={`pill ${PILL[s.state]}`}>{s.state.toUpperCase()}</span>{' '}
          <span className="muted">{s.dates}</span>
          {s.note ? <p className="muted">{s.note}</p> : null}
          {s.shipped.length > 0 ? (
            <ul>
              {s.shipped.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ))}

      <h2>Waiting on Darshil</h2>
      <div className="card">
        <ul>
          {WAITING_ON_OWNER.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      </div>
    </>
  );
}
