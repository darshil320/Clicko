import { Avatar, Button, Card, ListRow, OfflineBanner, Screen, Section, Text } from '@clickco/ui';
import FileText from 'lucide-react-native/icons/file-text';
import LifeBuoy from 'lucide-react-native/icons/life-buoy';
import Scale from 'lucide-react-native/icons/scale';
import ShieldCheck from 'lucide-react-native/icons/shield-check';
import UserX from 'lucide-react-native/icons/user-x';
import { View } from 'react-native';
import { API_URL, IS_DEV } from '@/shared/config';
import { isOffline } from '@/shared/errors';
import { formatPhone } from '@/shared/format/phone';
import { openLegal } from '@/shared/legal';
import { useSession } from '@/shared/session/store';
import { useMe, useSignOut } from '../hooks';

export interface ProfileViewProps {
  /** Opens the "Get help" ticket form (features/care, composed in by the route). */
  readonly onGetHelp: () => void;
  /** Opens "Delete account" (features/account, composed in by the route). */
  readonly onDeleteAccount: () => void;
}

/**
 * Profile tab: who is signed in, help, sign out and delete account. Editing details arrives with
 * Wave 2 screens.
 */
export function ProfileView({ onGetHelp, onDeleteAccount }: ProfileViewProps) {
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
      <Section title="Legal">
        <Card padding="list">
          <ListRow
            icon={ShieldCheck}
            title="Privacy Policy"
            subtitle="What we collect, your rights, withdrawing consent"
            accessory="chevron"
            onPress={() => openLegal('privacy')}
            divider
          />
          <ListRow
            icon={FileText}
            title="Terms and refund policy"
            accessory="chevron"
            onPress={() => openLegal('terms')}
            divider
          />
          <ListRow
            icon={Scale}
            title="Grievance Officer"
            subtitle="Complaints: answered within 48 hours, resolved within 30 days"
            accessory="chevron"
            onPress={() => openLegal('grievance')}
          />
        </Card>
      </Section>
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
      <Card padding="list">
        <ListRow
          icon={UserX}
          iconTone="danger"
          title="Delete account"
          subtitle="See what's erased and what's kept first"
          accessory="chevron"
          onPress={onDeleteAccount}
          testID="profile-delete-account"
        />
      </Card>
    </Screen>
  );
}
