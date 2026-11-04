/**
 * Command-line options of the dry run. Every value has a development default, so
 * `tsx scripts/dry-run/run.ts` drives the local API (:4000) with the dev seed accounts.
 */
import { parseArgs } from 'node:util';

export interface DryRunOptions {
  readonly api: string;
  /** Where progress is saved, so a run paused at check-out can be resumed. */
  readonly stateFile: string;
  readonly resume: boolean;
  /** Wait in-process for check-out to open (up to this many minutes); 0 = pause and exit. */
  readonly maxWaitMinutes: number;
  /** Minutes from now to the scheduled start (the ruleset's minimum lead is about 120). */
  readonly leadMinutes: number;
  readonly hours: number;
  readonly tier: 'BASIC' | 'PROFESSIONAL' | 'EXPERT';
  readonly category: string;
  readonly pincode: string;
  /** Where the photographer "is" at check-in/out (default: the Surat city centre, see README). */
  readonly lat: number;
  readonly lng: number;
  readonly clientPhone: string;
  readonly staffEmail: string;
  readonly staffPassword: string;
  /** Base32 authenticator secret of the staff account (dev seed: public, apps/api/CLAUDE.md). */
  readonly staffTotpSecret: string;
}

/** The dev seed's public staff credentials (apps/api/CLAUDE.md). Never valid outside a local DB. */
const DEV_STAFF = {
  email: 'quality@clickco.test',
  password: 'clickco-dev-staff-only',
  totpSecret: 'CLICKCODEVSTAFFTOTPSECRETAAAAAAA',
} as const;

/** Surat centre (apps/api seeds/launch-cities.ts): the fallback geofence point for 395xxx. */
const SURAT_CENTRE = { lat: 21.1702, lng: 72.8311 } as const;

const TIERS = ['BASIC', 'PROFESSIONAL', 'EXPERT'] as const;

/** A fresh client each run: +91 99990 1xxxx (the photographer seed uses 99990 00xxx). */
function randomClientPhone(): string {
  const tail = String(Math.floor(Math.random() * 10_000)).padStart(4, '0');
  return `+91999901${tail}`;
}

function intOption(raw: string | undefined, name: string, fallback: number): number {
  if (raw === undefined) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || String(value) !== raw.trim()) {
    throw new Error(`--${name} must be a whole number`);
  }
  return value;
}

function coordinate(raw: string | undefined, name: string, fallback: number): number {
  if (raw === undefined) return fallback;
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value)) throw new Error(`--${name} must be a number`);
  return value;
}

export function parseOptions(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): DryRunOptions {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      api: { type: 'string' },
      state: { type: 'string' },
      resume: { type: 'boolean', default: false },
      'max-wait-minutes': { type: 'string' },
      'lead-minutes': { type: 'string' },
      hours: { type: 'string' },
      tier: { type: 'string' },
      category: { type: 'string' },
      pincode: { type: 'string' },
      lat: { type: 'string' },
      lng: { type: 'string' },
      'client-phone': { type: 'string' },
    },
    strict: true,
  });
  const tier = (values.tier ?? 'PROFESSIONAL').toUpperCase();
  if (!(TIERS as readonly string[]).includes(tier)) {
    throw new Error(`--tier must be one of ${TIERS.join(', ')}`);
  }
  const hours = intOption(values.hours, 'hours', 2);
  if (hours < 2 || hours > 12) throw new Error('--hours must be 2–12');
  return {
    api: (values.api ?? env.DRY_RUN_API ?? 'http://localhost:4000').replace(/\/+$/, ''),
    stateFile: values.state ?? env.DRY_RUN_STATE ?? '.dry-run-state.json',
    resume: values.resume ?? false,
    maxWaitMinutes: intOption(values['max-wait-minutes'], 'max-wait-minutes', 0),
    leadMinutes: intOption(values['lead-minutes'], 'lead-minutes', 125),
    hours,
    tier: tier as DryRunOptions['tier'],
    category: values.category ?? 'FOOD',
    pincode: values.pincode ?? '395007',
    lat: coordinate(values.lat, 'lat', SURAT_CENTRE.lat),
    lng: coordinate(values.lng, 'lng', SURAT_CENTRE.lng),
    clientPhone: values['client-phone'] ?? env.DRY_RUN_CLIENT_PHONE ?? randomClientPhone(),
    staffEmail: env.DRY_RUN_STAFF_EMAIL ?? DEV_STAFF.email,
    staffPassword: env.DRY_RUN_STAFF_PASSWORD ?? DEV_STAFF.password,
    staffTotpSecret: env.DRY_RUN_STAFF_TOTP_SECRET ?? DEV_STAFF.totpSecret,
  };
}
