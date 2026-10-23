'use client';

import { useParams } from 'next/navigation';
import { UploadPanel } from '../../../../src/features/upload/upload-panel';

export default function UploadPage() {
  const { id } = useParams<{ id: string }>();
  return <UploadPanel bookingId={id} />;
}
