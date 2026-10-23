import { color } from '@clickco/design-tokens';
import { fontFaceFor, Icon, type LucideIcon } from '@clickco/ui';
import { Tabs } from 'expo-router/js-tabs';
import CalendarCheck from 'lucide-react-native/icons/calendar-check';
import House from 'lucide-react-native/icons/house';
import LifeBuoy from 'lucide-react-native/icons/life-buoy';
import UserRound from 'lucide-react-native/icons/user-round';
import { useMe } from '@/features/auth';

const tabIcon =
  (glyph: LucideIcon) =>
  ({ focused }: { focused: boolean }) => (
    <Icon icon={glyph} tone={focused ? 'primary' : 'tertiary'} />
  );

export default function TabsLayout() {
  useMe();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: color.surface.base },
        tabBarStyle: { backgroundColor: color.surface.raised, borderTopColor: color.border.subtle },
        tabBarActiveTintColor: color.text.primary,
        tabBarInactiveTintColor: color.text.tertiary,
        tabBarLabelStyle: { fontFamily: fontFaceFor('micro') },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: tabIcon(House) }} />
      <Tabs.Screen
        name="bookings"
        options={{ title: 'Bookings', tabBarIcon: tabIcon(CalendarCheck) }}
      />
      <Tabs.Screen name="help" options={{ title: 'Help', tabBarIcon: tabIcon(LifeBuoy) }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: tabIcon(UserRound) }} />
    </Tabs>
  );
}
