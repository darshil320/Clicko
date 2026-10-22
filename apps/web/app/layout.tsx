import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { LEGAL } from '../src/legal/config';
import { siteCss } from '../src/theme';

export const metadata: Metadata = {
  title: { default: LEGAL.brandName, template: `%s · ${LEGAL.brandName}` },
  description: 'On-demand professional photography in Surat, Mumbai and Vadodara.',
};

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="en-IN">
      <head>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: token-generated CSS, no user input */}
        <style dangerouslySetInnerHTML={{ __html: siteCss() }} />
      </head>
      <body>
        <nav>
          <a className="brand" href="/">
            {LEGAL.brandName}
          </a>
          <a href="/terms/">Terms</a>
          <a href="/refund-policy/">Refund &amp; cancellation</a>
          <a href="/privacy/">Privacy</a>
          <a href="/grievance/">Grievance redressal</a>
        </nav>
        <main>{children}</main>
        <footer>
          © {new Date().getFullYear()} {LEGAL.entityName}. {LEGAL.brandName} is operated by{' '}
          {LEGAL.entityName}. Courts at {LEGAL.jurisdiction} have exclusive jurisdiction.
        </footer>
      </body>
    </html>
  );
}
