import type { Metadata } from 'next';
import { AlertsFeed } from '../../../src/features/alerts/alerts-feed';

export const metadata: Metadata = { title: 'Alerts' };

export default function AlertsPage() {
  return <AlertsFeed />;
}
