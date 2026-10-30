import type { Metadata } from 'next';
import { ReviewsDesk } from '../../../src/features/reviews/reviews-desk';

export const metadata: Metadata = { title: 'To settle' };

export default function ReviewsPage() {
  return <ReviewsDesk />;
}
