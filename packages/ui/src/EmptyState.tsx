import ImageIcon from 'lucide-react-native/icons/image';
import type { ReactNode } from 'react';
import { View } from 'react-native';
import { Button } from './Button';
import type { LucideIcon } from './Icon';
import { IconTile } from './IconTile';
import { Text } from './Text';

export interface EmptyStateProps {
  readonly title: string;
  readonly body?: string;
  /** Exactly one action (DESIGN.md §Layout rules). */
  readonly action?: { readonly label: string; readonly onPress: () => void };
  /** The illustration slot. Until illustrations exist, an icon tile stands in. */
  readonly illustration?: ReactNode;
  readonly icon?: LucideIcon;
  readonly testID?: string;
}

/** Centred and airy: an icon tile, a confident title, one calm line, one action. */
export function EmptyState({
  title,
  body,
  action,
  illustration,
  icon = ImageIcon,
  testID,
}: EmptyStateProps) {
  return (
    <View className="items-center gap-5 px-5 py-12" testID={testID}>
      {illustration ?? <IconTile icon={icon} size="lg" shape="circle" />}
      <View className="items-center gap-2">
        <Text variant="h2" align="center" accessibilityRole="header">
          {title}
        </Text>
        {body ? (
          <Text variant="body" tone="secondary" align="center">
            {body}
          </Text>
        ) : null}
      </View>
      {action ? <Button label={action.label} variant="secondary" onPress={action.onPress} /> : null}
    </View>
  );
}
