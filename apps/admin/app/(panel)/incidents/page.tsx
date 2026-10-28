import type { Metadata } from 'next';
import { IncidentsDesk } from '../../../src/features/incidents/incidents-desk';

export const metadata: Metadata = { title: 'Incidents' };

export default function IncidentsPage() {
  return <IncidentsDesk />;
}
