import type { Metadata } from 'next';
import { TicketsDesk } from '../../../src/features/tickets/tickets-desk';

export const metadata: Metadata = { title: 'Support tickets' };

export default function TicketsPage() {
  return <TicketsDesk />;
}
