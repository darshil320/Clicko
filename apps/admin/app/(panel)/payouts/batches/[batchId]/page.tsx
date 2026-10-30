import type { Metadata } from 'next';
import { BatchPage } from '../../../../../src/features/payouts/batch-page';

export const metadata: Metadata = { title: 'Payout batch' };

export default async function PayoutBatchRoute({
  params,
}: {
  readonly params: Promise<{ batchId: string }>;
}) {
  const { batchId } = await params;
  return <BatchPage batchId={batchId} />;
}
