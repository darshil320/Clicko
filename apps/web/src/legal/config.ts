/**
 * Values the published legal pages depend on. Sources:
 *  - entityName: Darshil, 22 Oct 2026
 *  - grievanceOfficer.name: Darshil, 14 Nov 2026 (Mehang Desai, Surat)
 *  - gst / jurisdiction / equipment cap / peak season: docs/DECISIONS/0005
 * Anything still TO_BE_CONFIRMED, an address without a pincode or an email without an @
 * blocks `build:production` (LEGAL_STRICT=1), which is what Vercel runs.
 */
export const TO_BE_CONFIRMED = 'To be confirmed';

export interface GrievanceOfficer {
  readonly name: string;
  readonly email: string;
  readonly phone: string;
  readonly address: string;
}

export interface LegalConfig {
  readonly brandName: string;
  readonly entityName: string;
  readonly registeredAddress: string;
  readonly siteUrl: string;
  readonly privacyEmail: string;
  readonly gst: 'EXCLUSIVE' | 'INCLUSIVE';
  readonly jurisdiction: string;
  readonly equipmentCapRupees: number;
  readonly peakSeason: string;
  readonly grievanceOfficer: GrievanceOfficer;
}

export const LEGAL: LegalConfig = {
  brandName: 'Clickco',
  entityName: 'Clicko',
  registeredAddress: TO_BE_CONFIRMED,
  siteUrl: 'https://clickco.in',
  privacyEmail: TO_BE_CONFIRMED,
  gst: 'EXCLUSIVE',
  jurisdiction: 'Surat, Gujarat',
  equipmentCapRupees: 200_000,
  peakSeason:
    'wedding season (1 Nov – 28 Feb); Diwali week; Navratri (Surat and Vadodara only); and ' +
    '24 Dec – 2 Jan. The exact Diwali and Navratri dates for each year are shown in the app ' +
    'before you pay',
  grievanceOfficer: {
    name: 'Mehang Desai',
    email: TO_BE_CONFIRMED,
    phone: TO_BE_CONFIRMED,
    address: 'Surat, Gujarat', // needs street and pincode before publishing
  },
};

/** A six-digit Indian pincode: what turns a city into a postal address. */
const PINCODE = /\b[1-9]\d{5}\b/;

function isIncomplete(key: string, value: string): boolean {
  if (value === TO_BE_CONFIRMED) return true;
  if (/address$/i.test(key)) return !PINCODE.test(value);
  if (/email$/i.test(key)) return !value.includes('@');
  return false;
}

/**
 * Dotted paths of every field that cannot be published: still TO_BE_CONFIRMED, an address
 * without a pincode, or an email without an @ (E-Commerce Rules 2020 r.4(1), r.4(4)).
 */
export function unresolvedFields(config: LegalConfig): string[] {
  const walk = (value: unknown, path: string, key: string): string[] => {
    if (typeof value === 'string') return isIncomplete(key, value) ? [path] : [];
    if (value && typeof value === 'object') {
      return Object.entries(value).flatMap(([k, v]) => walk(v, path ? `${path}.${k}` : k, k));
    }
    return [];
  };
  return walk(config, '', '');
}
