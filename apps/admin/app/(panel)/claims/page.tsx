import type { Metadata } from 'next';
import { ClaimsDesk } from '../../../src/features/claims/claims-desk';

export const metadata: Metadata = { title: 'Equipment claims' };

export default function ClaimsPage() {
  return <ClaimsDesk />;
}
