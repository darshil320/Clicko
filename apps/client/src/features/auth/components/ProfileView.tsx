import { Avatar, Button, Card, ListRow, Screen, Section, Text } from '@clickco/ui';
import { View } from 'react-native';
import { API_URL, IS_DEV } from '@/shared/config';
import { userMessage } from '@/shared/errors';
import { formatPhone } from '@/shared/format/phone';
import { useSession } from '@/shared/session/store';
import { useMe, useSignOut } from '../hooks';

/** Profile tab: who is signed in, and sign out. Editing details arrives with Wave 2 screens. */
export function ProfileView() {
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
      {me.isError ? (
        <Text variant="caption" tone="danger">
          {userMessage(me.error)}
        </Text>
      ) : null}
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
