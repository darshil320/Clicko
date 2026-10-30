import type { Metadata } from 'next';
import { PayoutsDesk } from '../../../src/features/payouts/payouts-desk';

export const metadata: Metadata = { title: 'Payouts' };

export default function PayoutsPage() {
  return <PayoutsDesk />;
}
