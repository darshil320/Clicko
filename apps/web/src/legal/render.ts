import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type LegalConfig, unresolvedFields } from './config';

// The spec is read-only and stays the source of the wording. The site renders it
// with placeholders filled; it never forks the text.
const TERMS_PATH = join(process.cwd(), '../../docs/clickco-terms-conditions-v2.md');

export function loadTerms(path: string = TERMS_PATH): string {
  return readFileSync(path, 'utf8');
}

const INDIAN = new Intl.NumberFormat('en-IN');

function replacements(c: LegalConfig): ReadonlyArray<readonly [string, string]> {
  const g = c.grievanceOfficer;
  return [
    ['# CLICKCO — TERMS & CONDITIONS (v2 DRAFT)', `# ${c.brandName} — Terms & Conditions`],
    ['[LEGAL ENTITY NAME], [Registered Address]', `${c.entityName}, ${c.registeredAddress}`],
    ['`[INCLUSIVE / EXCLUSIVE]`', c.gst === 'EXCLUSIVE' ? 'exclusive' : 'inclusive'],
    [
      '`[LIST SPECIFIC DATE RANGES — e.g. 1 Nov – 28 Feb; Diwali week; Navratri; 24 Dec – 2 Jan]`',
      c.peakSeason,
    ],
    ['`[REFUND POLICY URL]`', `${c.siteUrl}/refund-policy/`],
    ['`[PRIVACY POLICY URL]`', `${c.siteUrl}/privacy/`],
    ['₹`[CAP — recommend 200,000]`', `₹${INDIAN.format(c.equipmentCapRupees)}`],
    ['`[PRIVACY EMAIL]`', c.privacyEmail],
    ['`[NAME]`', g.name],
    ['`[GRIEVANCE EMAIL]`', g.email],
    ['`[PHONE]`', g.phone],
    ['`[ADDRESS]`', g.address],
    ['`[Surat, Gujarat]`', c.jurisdiction],
  ];
}

export interface RenderOptions {
  /** Production build: refuse to publish while any field is unresolved. */
  readonly strict?: boolean;
}

/** Published T&C markdown: reviewer note and changelog removed, placeholders filled. */
export function renderTerms(
  source: string,
  config: LegalConfig,
  options: RenderOptions = {},
): string {
  const pending = unresolvedFields(config);
  if (options.strict && pending.length > 0) {
    throw new Error(`Legal pages cannot be published; unresolved: ${pending.join(', ')}`);
  }

  const changelogAt = source.indexOf('# CHANGELOG');
  const body = (changelogAt === -1 ? source : source.slice(0, changelogAt))
    .split('\n')
    .filter((line) => !line.startsWith('> ⚠ **Not legal advice.**'))
    .join('\n')
    .replace(/(\n---\s*)+$/, '\n');

  return replacements(config).reduce((text, [placeholder, value]) => {
    if (!text.includes(placeholder)) {
      throw new Error(`T&C placeholder not found: ${placeholder} — the spec text has changed`);
    }
    return text.split(placeholder).join(value);
  }, body);
}

/** One `## N.` section (heading included) of already-rendered terms. */
export function extractSection(renderedTerms: string, number: number): string {
  const start = renderedTerms.indexOf(`\n## ${number}. `);
  if (start === -1) throw new Error(`T&C section ${number} not found`);
  const next = renderedTerms.indexOf('\n## ', start + 1);
  return renderedTerms.slice(start + 1, next === -1 ? undefined : next).replace(/\n---\s*$/, '\n');
}
