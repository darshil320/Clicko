import type { Metadata } from 'next';
import { PhotographerProfilePage } from '../../../../src/features/photographers/profile-page';

export const metadata: Metadata = { title: 'Photographer' };

export default async function PhotographerRoute({
  params,
}: {
  readonly params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <PhotographerProfilePage photographerId={id} />;
}
