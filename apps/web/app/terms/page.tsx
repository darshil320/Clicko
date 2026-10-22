import type { Metadata } from 'next';
import { DraftNotice } from '../../src/DraftNotice';
import { publishedTerms } from '../../src/legal/load';
import { Markdown } from '../../src/Markdown';

export const metadata: Metadata = { title: 'Terms & Conditions' };

export default function Terms() {
  return (
    <>
      <DraftNotice />
      <Markdown source={publishedTerms()} />
    </>
  );
}
