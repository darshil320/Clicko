import type { Metadata } from 'next';
import { DraftNotice } from '../../src/DraftNotice';
import { legalContent } from '../../src/legal/content';
import { Markdown } from '../../src/Markdown';

export const metadata: Metadata = { title: 'Delete your account' };

// Google Play User Data policy: the deletion request page linked from the Data safety form.
export default function DeleteAccount() {
  return (
    <>
      <DraftNotice />
      <Markdown source={legalContent('delete-account')} />
    </>
  );
}
