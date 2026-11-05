import { Avatar, Button, Card, ListRow, OfflineBanner, Screen, Section, Text } from '@clickco/ui';
import LifeBuoy from 'lucide-react-native/icons/life-buoy';
import { View } from 'react-native';
import { API_URL, IS_DEV } from '@/shared/config';
import { isOffline } from '@/shared/errors';
import { formatPhone } from '@/shared/format/phone';
import { useSession } from '@/shared/session/store';
import { useMe, useSignOut } from '../hooks';

export interface ProfileViewProps {
  /** Opens the "Get help" ticket form (features/care, composed in by the route). */
  readonly onGetHelp: () => void;
}

/** Profile tab: who is signed in, help, and sign out. Editing details arrives with Wave 2 screens. */
export function ProfileView({ onGetHelp }: ProfileViewProps) {
  const user = useSession((s) => s.user);
  const me = useMe();
  const signOut = useSignOut();
  const name = user?.fullName ?? 'Clickco member';

  return (
    <Screen title="Profile">
      <Card className="flex-row items-center gap-4">
        <Avatar name={user?.fullName ?? ''} size="lg" />
        <View className="flex-1 gap-1">
          <Text variant="h3">{name}</Text>
          <Text tone="secondary" tabular>
            {user ? formatPhone(user.phone) : ''}
          </Text>
        </View>
      </Card>
      {/* Offline is already said by Screen's banner; the saved details still show. */}
      {me.isError && !isOffline(me.error) ? (
        <OfflineBanner
          kind="stale"
          title="Couldn't refresh your profile"
          body="Showing the details saved on this phone."
          retrying={me.isFetching}
          onRetry={() => void me.refetch()}
        />
      ) : null}
      <Card padding="list">
        <ListRow
          icon={LifeBuoy}
          title="Get help"
          subtitle="Payments, a shoot, your photos or your data"
          accessory="chevron"
          onPress={onGetHelp}
          testID="profile-get-help"
        />
      </Card>
      {IS_DEV ? (
        <Section title="Developer">
          <Card>
            <ListRow title="API" subtitle={API_URL} />
            <Text variant="caption" tone="tertiary">
              Development build
            </Text>
          </Card>
        </Section>
      ) : null}
      <Button
        label="Sign out"
        variant="secondary"
        loading={signOut.isPending}
        onPress={() => signOut.mutate()}
        testID="sign-out"
      />
    </Screen>
  );
}
