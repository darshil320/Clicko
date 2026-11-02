import RefreshCw from 'lucide-react-native/icons/refresh-cw';
import WifiOff from 'lucide-react-native/icons/wifi-off';
import { View } from 'react-native';
import { Button } from './Button';
import { Card } from './Card';
import { IconTile } from './IconTile';
import { type BannerKind, bannerContent, STATE_COPY } from './states.copy';
import { Text } from './Text';

export interface OfflineBannerProps {
  /** "offline" (default): no connection. "stale": the last refresh failed, older data shows. */
  readonly kind?: BannerKind;
  readonly title?: string;
  readonly body?: string;
  readonly onRetry?: () => void;
  readonly retrying?: boolean;
  readonly testID?: string;
}

/**
 * A calm, compact strip above a screen's content. Screen renders the "offline" one by itself
 * whenever the app's NetworkStatusProvider says so; screens add a "stale" one when a refresh
 * failed but what they last loaded is still on show. Announced as it appears.
 */
export function OfflineBanner({
  kind = 'offline',
  title,
  body,
  onRetry,
  retrying = false,
  testID,
}: OfflineBannerProps) {
  const content = bannerContent(kind, { title, body });
  return (
    <Card
      padding="compact"
      className="flex-row items-center gap-3"
      testID={testID ?? `banner-${kind}`}
    >
      <View
        className="flex-1 flex-row items-center gap-3"
        accessible
        accessibilityLiveRegion="polite"
        accessibilityLabel={`${content.title}. ${content.body}`}
      >
        <IconTile
          icon={kind === 'offline' ? WifiOff : RefreshCw}
          tone={content.tone}
          size="sm"
          shape="circle"
        />
        <View className="flex-1 gap-1">
          <Text variant="bodyStrong">{content.title}</Text>
          <Text variant="caption" tone="secondary">
            {content.body}
          </Text>
        </View>
      </View>
      {onRetry ? (
        <Button
          label={STATE_COPY.bannerRetry}
          variant="ghost"
          size="compact"
          loading={retrying}
          onPress={onRetry}
          accessibilityLabel={kind === 'offline' ? 'Retry connecting' : 'Retry refreshing'}
        />
      ) : null}
    </Card>
  );
}
