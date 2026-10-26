import { LEGAL } from '../legal/config';

export const SITE = {
  name: LEGAL.brandName,
  legalName: LEGAL.entityName,
  /** Canonical origin. Every canonical, sitemap and JSON-LD URL is built from this. */
  url: LEGAL.siteUrl,
  locale: 'en_IN',
  tagline: 'Photographers and videographers, booked in minutes',
  description:
    'Book a photographer or videographer in Surat, Mumbai or Vadodara for proposals, trips, ' +
    'content days and more. Photo shoots from ₹3,500 + GST for 2 hours; photos within 48 hours.',
  /** Bump when page copy changes materially; feeds sitemap <lastmod>. */
  contentUpdated: '2026-10-26',
} as const;

/**
 * Placeholder inboxes — Darshil to confirm the real addresses before launch.
 * Kept here so swapping them is a one-line change.
 */
export const CONTACT = {
  photographerApply: 'mailto:join@clickco.in?subject=Apply%20to%20join%20Clickco',
  signatureEnquiry: 'mailto:hello@clickco.in?subject=Signature%20enquiry',
} as const;

export interface NavLink {
  readonly label: string;
  readonly href: string;
}

export const PRIMARY_NAV: readonly NavLink[] = [
  { label: 'Home', href: '/' },
  { label: 'Cities', href: '/cities/' },
  { label: 'Pricing', href: '/#pricing' },
  { label: 'For photographers', href: CONTACT.photographerApply },
  { label: 'Help', href: '/#faq' },
];

/** Required before payment by the app stores and the Consumer Protection (E-Commerce) Rules. */
export const LEGAL_LINKS: readonly NavLink[] = [
  { label: 'Terms & Conditions', href: '/terms/' },
  { label: 'Refund & Cancellation', href: '/refund-policy/' },
  { label: 'Privacy Policy', href: '/privacy/' },
  { label: 'Grievance Redressal', href: '/grievance/' },
];

/** Legal page paths, for the sitemap. */
export const LEGAL_PATHS: readonly string[] = LEGAL_LINKS.map((link) => link.href);
