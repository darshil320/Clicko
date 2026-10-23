import ImageIcon from 'lucide-react-native/icons/image';
import type { ReactNode } from 'react';
import { View } from 'react-native';
import { Button } from './Button';
import { Icon, type LucideIcon } from './Icon';
import { Text } from './Text';

export interface EmptyStateProps {
  readonly title: string;
  readonly body?: string;
  /** Exactly one action (DESIGN.md §Layout rules). */
  readonly action?: { readonly label: string; readonly onPress: () => void };
  /** The illustration slot. Until illustrations exist, an icon stands in. */
  readonly illustration?: ReactNode;
  readonly icon?: LucideIcon;
  readonly testID?: string;
}

export function EmptyState({
  title,
  body,
  action,
  illustration,
  icon = ImageIcon,
  testID,
}: EmptyStateProps) {
  return (
    <View className="items-center gap-4 px-5 py-10" testID={testID}>
      <View className="h-14 w-14 items-center justify-center rounded-full bg-surface-raised">
        {illustration ?? <Icon icon={icon} tone="tertiary" />}
      </View>
      <View className="items-center gap-2">
        <Text variant="h3" align="center" accessibilityRole="header">
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
