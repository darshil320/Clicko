/**
 * Values the published legal pages depend on. Sources:
 *  - entityName: Darshil, 22 Oct 2026
 *  - gst / jurisdiction / equipment cap / peak season: docs/DECISIONS/0005
 * Anything still TO_BE_CONFIRMED blocks `build:production` (LEGAL_STRICT=1).
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
    name: TO_BE_CONFIRMED,
    email: TO_BE_CONFIRMED,
    phone: TO_BE_CONFIRMED,
    address: TO_BE_CONFIRMED,
  },
};

/** Dotted paths of every field still set to TO_BE_CONFIRMED. */
export function unresolvedFields(config: LegalConfig): string[] {
  const walk = (value: unknown, path: string): string[] => {
    if (value === TO_BE_CONFIRMED) return [path];
    if (value && typeof value === 'object') {
      return Object.entries(value).flatMap(([k, v]) => walk(v, path ? `${path}.${k}` : k));
    }
    return [];
  };
  return walk(config, '');
}
