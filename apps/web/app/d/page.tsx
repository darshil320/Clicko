import type { Metadata } from 'next';
import { DeliveryPage } from '../../src/components/delivery/DeliveryPage';
import { resolveApiBase } from '../../src/lib/api-base';

/**
 * /d/<token> (ADR-0027 D6c). The export builds this one page as out/d/index.html; vercel.json
 * rewrites every /d/<token> to it, and the browser reads the token from its own address. Private
 * by design: no index, no Referer, no cache (vercel.json sends the same as headers).
 */
export const metadata: Metadata = {
  title: 'Your files',
  description: 'Download the photos and videos from your Clickco shoot.',
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
};

export default function Delivery() {
  // Runs at export time, like the waitlist: a deployed page never calls localhost (audit M1).
  const api = resolveApiBase(process.env);
  return (
    <div className="page">
      <DeliveryPage apiBase={api.kind === 'live' ? api.base : null} />
    </div>
  );
}
