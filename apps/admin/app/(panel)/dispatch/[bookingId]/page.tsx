import type { Metadata } from 'next';
import { DispatchDetail } from '../../../../src/features/dispatch/dispatch-detail';

export const metadata: Metadata = { title: 'Dispatch' };

export default async function DispatchDetailPage({
  params,
}: {
  readonly params: Promise<{ bookingId: string }>;
}) {
  const { bookingId } = await params;
  return <DispatchDetail bookingId={bookingId} />;
}
