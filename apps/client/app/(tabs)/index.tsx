import { Icon, Screen } from '@clickco/ui';
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
        <View className="flex-row items-center justify-between gap-3">
          <LocationPicker />
          <View className="h-tap w-tap items-center justify-center">
            <Icon icon={Bell} tone="secondary" accessibilityLabel="Notifications" />
          </View>
        </View>
      }
      eyebrow="Clickco"
      title="Book a photographer"
      subtitle={
        location.isDefault
          ? 'Prices shown for Surat. Set your pincode for exact prices.'
          : `Professional photographers in ${location.label}`
      }
    >
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
