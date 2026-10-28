import { themeStylesheet } from '@clickco/ui-web';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import type { ReactNode } from 'react';
import './globals.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: { default: 'Clickco Admin', template: '%s · Clickco Admin' },
  robots: { index: false, follow: false },
};

/**
 * Async: the CSP nonce comes from the request (proxy.ts), so every page renders per request.
 * The theme's values (`:root` variables from design tokens) go in a nonce'd style element.
 */
export default async function RootLayout({ children }: { readonly children: ReactNode }) {
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return (
    <html lang="en-IN">
      <head>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: token-generated CSS, no user input */}
        <style nonce={nonce} dangerouslySetInnerHTML={{ __html: themeStylesheet() }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
