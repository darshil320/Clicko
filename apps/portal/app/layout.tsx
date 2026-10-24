import type { Metadata } from 'next';
import { headers } from 'next/headers';
import type { ReactNode } from 'react';
import { portalCss } from '../src/shared/theme';
import { SignOut } from './sign-out';

export const metadata: Metadata = {
  title: { default: 'Clickco Upload', template: '%s · Clickco Upload' },
  robots: { index: false, follow: false },
};

/** Async: the CSP nonce comes from the request (proxy.ts), so every page renders per request. */
export default async function RootLayout({ children }: { readonly children: ReactNode }) {
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return (
    <html lang="en-IN">
      <head>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: token-generated CSS, no user input */}
        <style nonce={nonce} dangerouslySetInnerHTML={{ __html: portalCss() }} />
      </head>
      <body>
        <header className="top">
          <div className="top-inner">
            <a className="brand" href="/jobs" aria-label="Clickco Upload — your shoots">
              <span className="brand-mark" aria-hidden="true" />
              <span>Clickco</span>
              <span className="brand-sub">Upload</span>
            </a>
            <nav className="nav" aria-label="Account">
              <SignOut />
            </nav>
          </div>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
