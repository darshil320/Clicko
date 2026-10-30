import type { Metadata } from 'next';
import { Today } from '../../../src/features/today/today';

export const metadata: Metadata = { title: 'Today' };

/** The panel's home (ADR-0026 D8): `/` lands here for everyone who can open it. */
export default function TodayPage() {
  return <Today />;
}
