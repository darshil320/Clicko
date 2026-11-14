import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LEGAL, type LegalConfig } from './config';

/** Legal pages written for the site (not quoted from the T&C spec), in apps/web/content. */
export type LegalContentName = 'privacy' | 'delete-account';

function placeholders(c: LegalConfig): ReadonlyArray<readonly [string, string]> {
  return [
    ['{{ENTITY}}', c.entityName],
    ['{{BRAND}}', c.brandName],
    ['{{ADDRESS}}', c.registeredAddress],
    ['{{PRIVACY_EMAIL}}', c.privacyEmail],
  ];
}

/** The page's markdown with every {{PLACEHOLDER}} filled from the legal config. */
export function legalContent(name: LegalContentName, config: LegalConfig = LEGAL): string {
  const source = readFileSync(join(process.cwd(), 'content', `${name}.md`), 'utf8');
  const filled = placeholders(config).reduce(
    (text, [token, value]) => text.split(token).join(value),
    source,
  );
  const leftover = filled.match(/\{\{[A-Z_]+\}\}/);
  if (leftover) throw new Error(`content/${name}.md: unknown placeholder ${leftover[0]}`);
  return filled;
}
