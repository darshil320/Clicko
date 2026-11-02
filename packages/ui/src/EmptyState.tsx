import ImageIcon from 'lucide-react-native/icons/image';
import type { ReactNode } from 'react';
import { View } from 'react-native';
import { Button } from './Button';
import { Card } from './Card';
import type { LucideIcon } from './Icon';
import { IconTile } from './IconTile';
import type { StateVariant } from './states.copy';
import { Text } from './Text';

export interface EmptyStateAction {
  readonly label: string;
  readonly onPress: () => void;
  /** Busy (e.g. a retry in flight): the button shows a spinner and ignores presses. */
  readonly loading?: boolean;
}

export interface EmptyStateProps {
  readonly title: string;
  readonly body?: string;
  /** Exactly one action (DESIGN.md §Layout rules). */
  readonly action?: EmptyStateAction;
  /** The illustration slot. Until illustrations exist, an icon tile stands in. */
  readonly illustration?: ReactNode;
  readonly icon?: LucideIcon;
  /** "page" (default): centred, the screen's body. "card": a compact card inside a section. */
  readonly variant?: StateVariant;
  /** Announce the block when it appears (errors do; calm empty states don't). */
  readonly announce?: boolean;
  readonly testID?: string;
}

/** A compact notice for a section that shares its screen: icon tile, title, one line, one action. */
function CardBlock({
  title,
  body,
  action,
  illustration,
  icon,
  announce,
  testID,
}: Required<Pick<EmptyStateProps, 'title' | 'icon'>> & Omit<EmptyStateProps, 'variant'>) {
  return (
    <Card className="gap-4" testID={testID}>
      <View
        className="flex-row items-center gap-4"
        accessibilityLiveRegion={announce ? 'polite' : undefined}
      >
        {illustration ?? <IconTile icon={icon} size="md" shape="circle" />}
        <View className="flex-1 gap-1">
          <Text variant="bodyStrong" accessibilityRole="header">
            {title}
          </Text>
          {body ? (
            <Text variant="caption" tone="secondary">
              {body}
            </Text>
          ) : null}
        </View>
      </View>
      {action ? (
        <Button
          label={action.label}
          variant="secondary"
          size="compact"
          loading={action.loading}
          onPress={action.onPress}
        />
      ) : null}
    </Card>
  );
}

/** Centred and airy: an icon tile, a confident title, one calm line, one action. */
export function EmptyState({
  title,
  body,
  action,
  illustration,
  icon = ImageIcon,
  variant = 'page',
  announce = false,
  testID,
}: EmptyStateProps) {
  if (variant === 'card') {
    return (
      <CardBlock
        title={title}
        body={body}
        action={action}
        illustration={illustration}
        icon={icon}
        announce={announce}
        testID={testID}
      />
    );
  }
  return (
    <View
      className="items-center gap-5 px-5 py-12"
      accessibilityLiveRegion={announce ? 'polite' : undefined}
      testID={testID}
    >
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
      {action ? (
        <Button
          label={action.label}
          variant="secondary"
          loading={action.loading}
          onPress={action.onPress}
        />
      ) : null}
    </View>
  );
}
