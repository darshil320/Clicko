import { EmptyState, Screen } from '@clickco/ui';
import { useRouter } from 'expo-router';
import CircleAlert from 'lucide-react-native/icons/circle-alert';

export default function NotFoundRoute() {
  const router = useRouter();
  return (
    <Screen>
      <EmptyState
        icon={CircleAlert}
        title="This page doesn't exist"
        action={{ label: 'Go home', onPress: () => router.navigate('/') }}
      />
    </Screen>
  );
}
