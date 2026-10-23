import { PlanTier } from '@clickco/contracts';
import { EmptyState, Screen, TIER_LABEL } from '@clickco/ui';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import CircleAlert from 'lucide-react-native/icons/circle-alert';
import { PlanDetailView, useStartBooking } from '@/features/booking';
import { useShootLocation } from '@/features/serviceability';

/** Screen 2 — Plan detail. The tier comes from the URL, so it is validated, never trusted. */
export default function PlanRoute() {
  const router = useRouter();
  const params = useLocalSearchParams<{ tier: string }>();
  const tier = PlanTier.safeParse(params.tier);
  const location = useShootLocation();
  const startBooking = useStartBooking();

  if (!tier.success) {
    return (
      <Screen topInset={false}>
        <EmptyState
          icon={CircleAlert}
          title="We don't have that plan"
          action={{ label: 'See all plans', onPress: () => router.navigate('/') }}
        />
      </Screen>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: TIER_LABEL[tier.data] }} />
      <PlanDetailView
        tier={tier.data}
        pincode={location.pincode}
        onContinue={(bookable) => {
          startBooking({ tier: bookable, pincode: location.pincode });
          router.push('/book/configure');
        }}
      />
    </>
  );
}
