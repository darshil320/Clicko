import { Avatar, Button, Card, ListRow, Screen, Section, Text } from '@clickco/ui';
import CircleAlert from 'lucide-react-native/icons/circle-alert';
import CloudOff from 'lucide-react-native/icons/cloud-off';
import { useState } from 'react';
import { View } from 'react-native';
import { API_URL, IS_DEV } from '@/shared/config';
import { formatDateTime } from '@/shared/format/datetime';
import { formatPhone } from '@/shared/format/phone';
import { ACTION_LABEL } from '@/shared/offline/queue';
import { flushQueue } from '@/shared/offline/runner';
import { useOnsiteQueue } from '@/shared/offline/store';
import { useSession } from '@/shared/session/store';
import { useSignOut } from '../hooks';

/** What is still waiting to reach Clickco, and what the server refused (ADR-0024 D5). */
function SyncSection() {
  const pending = useOnsiteQueue((s) => s.pending);
  const failed = useOnsiteQueue((s) => s.failed);
  const dismiss = useOnsiteQueue((s) => s.dismiss);
  const retryAll = useOnsiteQueue((s) => s.retryAll);

  if (pending.length === 0 && failed.length === 0) {
    return (
      <Section title="Sync">
        <Card>
          <Text tone="secondary">Everything you did on site has reached Clickco.</Text>
        </Card>
      </Section>
    );
  }

  return (
    <Section title="Sync" subtitle="Actions you took without signal keep the time you tapped them.">
      {pending.length > 0 ? (
        <Card className="gap-1">
          {pending.map((item, i) => (
            <ListRow
              key={item.id}
              icon={CloudOff}
              iconTone="secondary"
              title={ACTION_LABEL[item.action.kind]}
              subtitle={`Waiting since ${formatDateTime(item.queuedAt)}`}
              divider={i < pending.length - 1}
            />
          ))}
          <Button
            label="Sync now"
            variant="secondary"
            size="compact"
            onPress={() => {
              retryAll();
              void flushQueue();
            }}
            testID="sync-now"
          />
        </Card>
      ) : null}
      {failed.map((item) => (
        <Card key={item.id} tone="warning" className="gap-3">
          <ListRow
            icon={CircleAlert}
            iconTone="danger"
            title={`${ACTION_LABEL[item.action.kind]} was not accepted`}
            subtitle={item.message}
          />
          <Button label="Dismiss" variant="ghost" size="compact" onPress={() => dismiss(item.id)} />
        </Card>
      ))}
    </Section>
  );
}

/** Profile tab: who is signed in, the sync queue, and sign out (warned if actions are unsent). */
export function ProfileView() {
  const photographer = useSession((s) => s.photographer);
  const pendingCount = useOnsiteQueue((s) => s.pending.length);
  const signOut = useSignOut();
  const [confirming, setConfirming] = useState(false);

  const onSignOut = () => {
    if (pendingCount > 0 && !confirming) {
      setConfirming(true);
      return;
    }
    signOut.mutate();
  };

  return (
    <Screen title="Profile">
      <Card className="flex-row items-center gap-4">
        <Avatar name={photographer?.displayName ?? ''} size="lg" />
        <View className="flex-1 gap-1">
          <Text variant="h3">{photographer?.displayName ?? 'Clickco photographer'}</Text>
          <Text tone="secondary" tabular>
            {photographer ? formatPhone(photographer.phone) : ''}
          </Text>
        </View>
      </Card>
      <SyncSection />
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
      {confirming ? (
        <Text tone="danger" accessibilityLiveRegion="polite">
          {pendingCount === 1 ? '1 action has' : `${pendingCount} actions have`} not reached Clickco
          yet. Signing out deletes {pendingCount === 1 ? 'it' : 'them'} from this phone.
        </Text>
      ) : null}
      <Button
        label={confirming ? 'Sign out anyway' : 'Sign out'}
        variant="secondary"
        loading={signOut.isPending}
        onPress={onSignOut}
        testID="sign-out"
      />
    </Screen>
  );
}
