import { useRouter } from 'expo-router';
import { ConfiguratorView } from '@/features/booking';
import { LocationPicker, useShootLocation } from '@/features/serviceability';

/** Screen 3 — Booking configurator. */
export default function ConfigureRoute() {
  const router = useRouter();
  const location = useShootLocation();
  return (
    <ConfiguratorView
      pincode={location.pincode}
      locationLabel={location.label}
      locationAction={<LocationPicker variant="change" />}
      onReview={() => router.push('/book/review')}
      onStartOver={() => router.dismissAll()}
    />
  );
}
