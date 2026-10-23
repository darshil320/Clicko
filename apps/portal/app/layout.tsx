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
          <a className="brand" href="/jobs">
            Clickco Upload
          </a>
          <nav>
            <a href="/jobs">Jobs</a>
            <SignOut />
          </nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
