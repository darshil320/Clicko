import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { portalCss } from '../src/shared/theme';
import { SignOut } from './sign-out';

export const metadata: Metadata = {
  title: { default: 'Clickco Upload', template: '%s · Clickco Upload' },
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="en-IN">
      <head>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: token-generated CSS, no user input */}
        <style dangerouslySetInnerHTML={{ __html: portalCss() }} />
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
