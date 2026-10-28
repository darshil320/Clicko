import { fontFaceFor, Icon, type LucideIcon, palette } from '@clickco/ui';
import { Tabs } from 'expo-router/js-tabs';
import BriefcaseBusiness from 'lucide-react-native/icons/briefcase-business';
import IndianRupee from 'lucide-react-native/icons/indian-rupee';
import UserRound from 'lucide-react-native/icons/user-round';

const tabIcon =
  (glyph: LucideIcon) =>
  ({ focused }: { focused: boolean }) => (
    <Icon icon={glyph} tone={focused ? 'primary' : 'tertiary'} />
  );

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: palette.surface.base },
        tabBarStyle: {
          backgroundColor: palette.surface.base,
          borderTopColor: palette.border.subtle,
        },
        tabBarActiveTintColor: palette.text.primary,
        tabBarInactiveTintColor: palette.text.tertiary,
        tabBarLabelStyle: { fontFamily: fontFaceFor('micro') },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: 'Jobs', tabBarIcon: tabIcon(BriefcaseBusiness) }}
      />
      <Tabs.Screen
        name="earnings"
        options={{ title: 'Earnings', tabBarIcon: tabIcon(IndianRupee) }}
      />
      <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: tabIcon(UserRound) }} />
    </Tabs>
  );
}
