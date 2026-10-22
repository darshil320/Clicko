import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { consoleCss } from '../src/theme';

export const metadata: Metadata = {
  title: { default: 'Clickco Console', template: '%s · Clickco Console' },
};

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="en-IN">
      <head>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: token-generated CSS, no user input */}
        <style dangerouslySetInnerHTML={{ __html: consoleCss() }} />
      </head>
      <body>
        <div className="shell">
          <aside>
            <a className="brand" href="/">
              Clickco Console
            </a>
            <div className="section">Build</div>
            <a href="/">Status &amp; roadmap</a>
            <div className="section">Ops tools</div>
            <a href="/serviceability">Pincode checker</a>
            <a href="/pricing">Quote calculator</a>
          </aside>
          <main>{children}</main>
        </div>
      </body>
    </html>
  );
}
