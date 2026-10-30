import type { Metadata } from 'next';
import { RefundsDesk } from '../../../src/features/refunds/refunds-desk';

export const metadata: Metadata = { title: 'Refunds' };

export default function RefundsPage() {
  return <RefundsDesk />;
}
