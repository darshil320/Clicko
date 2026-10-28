import { Button, Card, IconTile, ListRow, Text } from '@clickco/ui';
import CircleAlert from 'lucide-react-native/icons/circle-alert';
import CloudOff from 'lucide-react-native/icons/cloud-off';
import { View } from 'react-native';
import { ACTION_LABEL, type FailedAction, type OnsiteActionKind } from '@/shared/offline/queue';
import { flushQueue } from '@/shared/offline/runner';
import { useOnsiteQueue } from '@/shared/offline/store';
import { describeRefusal } from '../lib/errors';

export interface SyncNoticeProps {
  readonly queued: readonly OnsiteActionKind[];
  readonly failed: readonly FailedAction[];
  readonly onDismiss: (id: string) => void;
}

/**
 * The calm offline banner (ADR-0024 D5) and this job's actions the server later refused, with
 * its reason. Both are announced as they appear.
 */
export function SyncNotice({ queued, failed, onDismiss }: SyncNoticeProps) {
  const retryAll = useOnsiteQueue((s) => s.retryAll);
  if (queued.length === 0 && failed.length === 0) return null;

  return (
    <View className="gap-3">
      {queued.length > 0 ? (
        <Card className="gap-3" testID="sync-banner">
          <View className="flex-row gap-3" accessible accessibilityLiveRegion="polite">
            <IconTile icon={CloudOff} size="sm" />
            <View className="flex-1 gap-1">
              <Text variant="bodyStrong">Saved on this phone</Text>
              <Text variant="caption" tone="secondary">
                It will send when you're back online. The time you tapped is kept.
              </Text>
              <Text variant="caption" tone="tertiary">
                Waiting to send: {queued.map((kind) => ACTION_LABEL[kind]).join(', ')}
              </Text>
            </View>
          </View>
          <Button
            label="Try sending now"
            variant="ghost"
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
        <Card key={item.id} tone="warning" className="gap-2">
          <View accessibilityRole="alert" accessibilityLiveRegion="polite">
            <ListRow
              icon={CircleAlert}
              iconTone="danger"
              title={`${ACTION_LABEL[item.kind]} wasn't accepted`}
              subtitle={describeRefusal(item, item.kind)}
            />
          </View>
          <Button
            label="Dismiss"
            variant="ghost"
            size="compact"
            onPress={() => onDismiss(item.id)}
            accessibilityLabel={`Dismiss: ${ACTION_LABEL[item.kind]} wasn't accepted`}
          />
        </Card>
      ))}
    </View>
  );
}
