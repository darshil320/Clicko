import type { Metadata } from 'next';
import { DraftNotice } from '../../src/DraftNotice';
import { publishedTerms } from '../../src/legal/load';
import { extractSection } from '../../src/legal/render';
import { Markdown } from '../../src/Markdown';

export const metadata: Metadata = { title: 'Refund & Cancellation Policy' };

// Quoted from the Terms so the two pages can never disagree.
export default function RefundPolicy() {
  const terms = publishedTerms();
  return (
    <>
      <DraftNotice />
      <h1>Refund &amp; Cancellation Policy</h1>
      <p>
        This policy is part of our <a href="/terms/">Terms &amp; Conditions</a>. Sections 3
        (cancellation) and 5 (delivery and data loss) are reproduced below.
      </p>
      <Markdown source={extractSection(terms, 3)} />
      <Markdown source={extractSection(terms, 5)} />
    </>
  );
}
