import type { Metadata } from 'next';
import { PhotographersDesk } from '../../../src/features/photographers/photographers-desk';

export const metadata: Metadata = { title: 'Photographers' };

export default function PhotographersPage() {
  return <PhotographersDesk />;
}
