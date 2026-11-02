'use client';

import { useEffect, useRef, useState } from 'react';
import {
  type DeliveryProblem,
  type DeliveryState,
  fetchDelivery,
  initialState,
  PROBLEM_COPY,
  tokenFromPath,
} from '../../lib/delivery';
import { paths } from '../../lib/routes';
import { DeliveryFiles } from './DeliveryFiles';

const TIMEOUT_MS = 15_000;

interface Loaded {
  readonly token: string | null;
  readonly state: DeliveryState;
  /** When the answer came: the countdown is computed in the visitor's browser. */
  readonly at: Date;
}

/**
 * The client side of /d/<token> (ADR-0027 D6c). The static export serves one HTML file for every
 * token (a Vercel rewrite keeps the address bar on /d/<token>), so the token is read from
 * `location.pathname` in the browser. This code sends it to the Clickco API only: the site loads no
 * analytics or third-party script, and the page sends no Referer. (The site's host still logs the
 * address it served: ADR-0027 D6c, accepted.)
 */
export function DeliveryPage({ apiBase }: { readonly apiBase: string | null }) {
  // "Try again" starts a fresh attempt: a new key remounts it, and it loads once.
  const [attempt, setAttempt] = useState(0);
  return (
    <DeliveryAttempt
      key={attempt}
      apiBase={apiBase}
      retried={attempt > 0}
      onRetry={() => setAttempt((n) => n + 1)}
    />
  );
}

interface AttemptProps {
  readonly apiBase: string | null;
  readonly retried: boolean;
  readonly onRetry: () => void;
}

function DeliveryAttempt({ apiBase, retried, onRetry }: AttemptProps) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const statusRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const token = tokenFromPath(window.location.pathname);
    // A malformed path or a build without an API stops here: nothing is fetched.
    setLoaded({ token, state: initialState(token, apiBase), at: new Date() });
    if (token === null || apiBase === null) return;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let current = true;
    fetchDelivery(apiBase, token, { signal: controller.signal }).then((state) => {
      clearTimeout(timer);
      if (current) setLoaded({ token, state, at: new Date() });
    });
    return () => {
      current = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [apiBase]);

  // A retry lands keyboard and screen-reader users on the new answer.
  useEffect(() => {
    if (retried && loaded !== null && loaded.state.kind !== 'loading') statusRef.current?.focus();
  }, [retried, loaded]);

  const state = loaded?.state ?? { kind: 'loading' };
  return (
    <section className="hero" aria-labelledby="delivery-title" aria-busy={state.kind === 'loading'}>
      <div className="wrap delivery-status" ref={statusRef} tabIndex={-1}>
        {state.kind === 'loading' ? (
          <div className="hero-copy" role="status">
            <p className="pill">Your delivery</p>
            <h1 id="delivery-title">Opening your files…</h1>
            <p className="lead">This takes a moment.</p>
          </div>
        ) : state.kind === 'ready' && loaded?.token && apiBase ? (
          <DeliveryFiles
            folder={state.folder}
            apiBase={apiBase}
            token={loaded.token}
            now={loaded.at}
          />
        ) : (
          <Problem kind={state.kind === 'ready' ? 'error' : state.kind} onRetry={onRetry} />
        )}
      </div>
    </section>
  );
}

function Problem({
  kind,
  onRetry,
}: {
  readonly kind: DeliveryProblem;
  readonly onRetry: () => void;
}) {
  const copy = PROBLEM_COPY[kind];
  return (
    <div className="hero-copy">
      <p className="pill">{copy.badge}</p>
      <h1 id="delivery-title">{copy.title}</h1>
      <p className="lead">{copy.detail}</p>
      <div className="actions">
        {copy.retry ? (
          <button className="btn btn-primary" type="button" onClick={onRetry}>
            Try again
          </button>
        ) : null}
        <a className="btn btn-secondary" href={paths.home}>
          Go to the home page
        </a>
      </div>
    </div>
  );
}
