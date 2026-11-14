/** The public site that hosts the legal pages (apps/web, LEGAL.siteUrl). */
const SITE_URL = 'https://clickco.in';

/** Every legal page the app links to. Kept one tap away (DPDP s.5, E-Commerce Rules r.4). */
export const LEGAL_URLS = {
  terms: `${SITE_URL}/terms/`,
  refunds: `${SITE_URL}/refund-policy/`,
  privacy: `${SITE_URL}/privacy/`,
  grievance: `${SITE_URL}/grievance/`,
  deleteAccount: `${SITE_URL}/delete-account/`,
} as const;

export type LegalPage = keyof typeof LEGAL_URLS;
