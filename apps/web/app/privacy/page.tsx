import type { Metadata } from 'next';
import { DraftNotice } from '../../src/DraftNotice';
import { legalContent } from '../../src/legal/content';
import { Markdown } from '../../src/Markdown';

export const metadata: Metadata = { title: 'Privacy Policy' };

export default function Privacy() {
  return (
    <>
      <DraftNotice />
      <Markdown source={legalContent('privacy')} />
    </>
  );
}
