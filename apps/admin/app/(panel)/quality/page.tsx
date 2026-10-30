import type { Metadata } from 'next';
import { QualityDesk } from '../../../src/features/quality/quality-desk';

export const metadata: Metadata = { title: 'Quality issues' };

export default function QualityPage() {
  return <QualityDesk />;
}
