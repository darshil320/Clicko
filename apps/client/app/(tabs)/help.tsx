import { EmptyState, Screen } from '@clickco/ui';
import { useRouter } from 'expo-router';
import LifeBuoy from 'lucide-react-native/icons/life-buoy';

/** Help — placeholder until the grievance/support surface (SA-02) ships in S11. */
export default function HelpRoute() {
  const router = useRouter();
  return (
    <Screen title="Help">
      <EmptyState
        icon={LifeBuoy}
        title="Help centre is on its way"
        body="Questions about a shoot? Open the booking — your updates and booking ID are there."
        action={{ label: 'Go to bookings', onPress: () => router.navigate('/bookings') }}
      />
    </Screen>
  );
}
