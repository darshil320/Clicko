import type { Metadata } from 'next';
import { PricingHome } from '../../../src/features/pricing/pricing-home';

export const metadata: Metadata = { title: 'Pricing' };

export default function PricingPage() {
  return <PricingHome />;
}
