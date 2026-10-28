import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { consoleCss } from '../../src/dev/theme';

export const metadata: Metadata = {
  title: { default: 'Developer', template: '%s · Developer · Clickco Admin' },
};

/**
 * The developer simulators (ADR-0025 D6): rendered only in development, a 404 everywhere else.
 * They call the API's /dev routes, which also answer 404 outside development.
 */
export default async function DevLayout({ children }: { readonly children: ReactNode }) {
  if (process.env.NODE_ENV !== 'development') notFound();
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return (
    <div className="dev-console">
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: token-generated CSS, no user input */}
      <style nonce={nonce} dangerouslySetInnerHTML={{ __html: consoleCss() }} />
      <div className="shell">
        <aside>
          <a className="brand" href="/dev">
            Clickco Developer
          </a>
          <a href="/">← Staff panel</a>
          <div className="section">Build</div>
          <a href="/dev">Status &amp; roadmap</a>
          <div className="section">Simulators</div>
          <a href="/dev/serviceability">Pincode checker</a>
          <a href="/dev/pricing">Quote calculator</a>
          <a href="/dev/bookings">Booking simulator</a>
          <a href="/dev/dispatch">Dispatch simulator</a>
        </aside>
        <main>{children}</main>
      </div>
    </div>
  );
}
