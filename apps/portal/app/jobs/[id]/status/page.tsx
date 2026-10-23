'use client';

import { useParams } from 'next/navigation';
import { StatusView } from '../../../../src/features/status/status-view';

export default function StatusPage() {
  const { id } = useParams<{ id: string }>();
  return <StatusView bookingId={id} />;
}
