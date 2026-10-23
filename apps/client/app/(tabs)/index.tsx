import { Icon, Screen, Text } from '@clickco/ui';
import { useRouter } from 'expo-router';
import Bell from 'lucide-react-native/icons/bell';
import { View } from 'react-native';
import { CategoryRow, EmergencyBanner, TierList, useStartBooking } from '@/features/booking';
import { BookAgain } from '@/features/bookings';
import { LocationPicker, useShootLocation } from '@/features/serviceability';
import { isBookableTier } from '@/shared/catalogue';

/** Screen 1 — Home. Composes serviceability (location), booking (tiers) and bookings (book again). */
export default function HomeRoute() {
  const router = useRouter();
  const location = useShootLocation();
  const startBooking = useStartBooking();
  const configure = () => router.push('/book/configure');

  return (
    <Screen
      header={
        <View className="flex-row items-center justify-between gap-3 pb-2">
          <Text variant="h2" accessibilityRole="header">
            Clickco
          </Text>
          <View className="flex-row items-center gap-2">
            <LocationPicker />
            <Icon icon={Bell} tone="secondary" accessibilityLabel="Notifications" />
          </View>
        </View>
      }
    >
      {location.isDefault ? (
        <Text variant="caption" tone="tertiary">
          Prices shown for Surat. Set your pincode for exact prices.
        </Text>
      ) : null}

      <EmergencyBanner
        onPress={() => {
          startBooking({ tier: 'PROFESSIONAL', pincode: location.pincode, when: 'earliest' });
          configure();
        }}
      />

      <CategoryRow
        onSelect={(categoryCode) => {
          startBooking({ tier: 'PROFESSIONAL', pincode: location.pincode, categoryCode });
          configure();
        }}
      />

      <TierList
        pincode={location.pincode}
        onSelect={(tier) => router.push({ pathname: '/plan/[tier]', params: { tier } })}
      />

      <BookAgain
        onRebook={(booking) => {
          if (!isBookableTier(booking.tier)) return;
          startBooking({
            tier: booking.tier,
            pincode: location.pincode,
            categoryCode: booking.categoryCode,
          });
          configure();
        }}
      />
    </Screen>
  );
}
