import type { Metadata } from 'next';
import { QaDesk } from '../../../src/features/qa/qa-desk';

export const metadata: Metadata = { title: 'QA' };

export default function QaPage() {
  return <QaDesk />;
}
