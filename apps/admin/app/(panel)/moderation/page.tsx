import type { Metadata } from 'next';
import { ModerationDesk } from '../../../src/features/moderation/moderation-desk';

export const metadata: Metadata = { title: 'Moderation' };

export default function ModerationPage() {
  return <ModerationDesk />;
}
