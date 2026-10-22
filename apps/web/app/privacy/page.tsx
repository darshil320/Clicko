import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Metadata } from 'next';
import { DraftNotice } from '../../src/DraftNotice';
import { LEGAL } from '../../src/legal/config';
import { Markdown } from '../../src/Markdown';

export const metadata: Metadata = { title: 'Privacy Policy' };

export default function Privacy() {
  const source = readFileSync(join(process.cwd(), 'content/privacy.md'), 'utf8')
    .replaceAll('{{ENTITY}}', LEGAL.entityName)
    .replaceAll('{{BRAND}}', LEGAL.brandName)
    .replaceAll('{{PRIVACY_EMAIL}}', LEGAL.privacyEmail);
  return (
    <>
      <DraftNotice />
      <Markdown source={source} />
    </>
  );
}
