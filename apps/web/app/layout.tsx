import { color } from '@clickco/design-tokens';
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { SiteFooter } from '../src/components/site/SiteFooter';
import { SiteHeader } from '../src/components/site/SiteHeader';
import { SITE } from '../src/content/site';
import { OG_IMAGE } from '../src/lib/metadata';
import { siteCss } from '../src/theme';

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: {
    default: `${SITE.name} — ${SITE.tagline}`,
    template: `%s · ${SITE.name}`,
  },
  description: SITE.description,
  applicationName: SITE.name,
  openGraph: {
    type: 'website',
    siteName: SITE.name,
    locale: SITE.locale,
    images: [OG_IMAGE],
  },
  twitter: { card: 'summary_large_image', images: [OG_IMAGE.url] },
  icons: {
    icon: [{ url: '/favicon.svg', type: 'image/svg+xml' }],
    apple: [{ url: '/touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: color.surface.base,
  colorScheme: 'dark',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="en-IN">
      <head>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: token-generated CSS, no user input */}
        <style dangerouslySetInnerHTML={{ __html: siteCss() }} />
      </head>
      <body>
        <SiteHeader />
        <main id="main" tabIndex={-1}>
          {children}
        </main>
        <SiteFooter />
      </body>
    </html>
  );
}
