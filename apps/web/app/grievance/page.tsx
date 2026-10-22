import type { Metadata } from 'next';
import { DraftNotice } from '../../src/DraftNotice';
import { publishedTerms } from '../../src/legal/load';
import { extractSection } from '../../src/legal/render';
import { Markdown } from '../../src/Markdown';

export const metadata: Metadata = { title: 'Grievance Redressal' };

export default function Grievance() {
  return (
    <>
      <DraftNotice />
      <Markdown source={extractSection(publishedTerms(), 12)} />
    </>
  );
}
