import type { Metadata } from 'next';
import { DispatchList } from '../../../src/features/dispatch/dispatch-list';

export const metadata: Metadata = { title: 'Dispatch' };

export default function DispatchPage() {
  return <DispatchList />;
}
