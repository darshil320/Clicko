import type { Metadata } from 'next';
import { BreachesDesk } from '../../../src/features/breaches/breaches-desk';

export const metadata: Metadata = { title: 'Breaches' };

export default function BreachesPage() {
  return <BreachesDesk />;
}
