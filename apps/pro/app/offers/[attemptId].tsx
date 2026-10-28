import { useLocalSearchParams } from 'expo-router';
import { OfferDetailView } from '@/features/offers';

export default function OfferRoute() {
  const { attemptId } = useLocalSearchParams<{ attemptId: string }>();
  return <OfferDetailView attemptId={attemptId} />;
}
