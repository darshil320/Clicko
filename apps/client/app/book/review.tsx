import { useRouter } from 'expo-router';
import { ReviewView } from '@/features/booking';
import { useShootLocation } from '@/features/serviceability';

/** Screen 4 — Quote review. */
export default function ReviewRoute() {
  const router = useRouter();
  const location = useShootLocation();
  return (
    <ReviewView
      locationLabel={location.label}
      onPaymentOpened={(id) => router.push({ pathname: '/book/pay/[id]', params: { id } })}
      onStartOver={() => router.dismissAll()}
    />
  );
}
