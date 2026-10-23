import type { Metadata } from 'next';
import { SITE } from '../content/site';

export const OG_IMAGE = {
  url: '/og.png',
  width: 1200,
  height: 630,
  alt: `${SITE.name} — professional photographers in Surat, Mumbai and Vadodara`,
} as const;

export interface PageMetaInput {
  /** Page title; the layout template appends " · Clickco" unless `absoluteTitle` is set. */
  readonly title: string;
  readonly description: string;
  /** Path with trailing slash, e.g. "/photographers/surat/". Becomes the canonical URL. */
  readonly path: string;
  readonly absoluteTitle?: boolean;
}

/**
 * Full metadata for a marketing page. Open Graph is set completely here because a page-level
 * `openGraph` replaces the layout's rather than merging with it.
 */
export function pageMetadata(input: PageMetaInput): Metadata {
  const socialTitle = input.absoluteTitle ? input.title : `${input.title} · ${SITE.name}`;
  return {
    title: input.absoluteTitle ? { absolute: input.title } : input.title,
    description: input.description,
    alternates: { canonical: input.path },
    openGraph: {
      type: 'website',
      siteName: SITE.name,
      locale: SITE.locale,
      title: socialTitle,
      description: input.description,
      url: input.path,
      images: [OG_IMAGE],
    },
    twitter: {
      card: 'summary_large_image',
      title: socialTitle,
      description: input.description,
      images: [OG_IMAGE.url],
    },
  };
}
