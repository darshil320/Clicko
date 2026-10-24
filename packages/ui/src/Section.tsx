import type { ReactNode } from 'react';
import { View } from 'react-native';
import { Text } from './Text';

export interface SectionProps {
  readonly title: string;
  /** One calm line under the title. */
  readonly subtitle?: string;
  /** A trailing control on the title row, e.g. a ghost "See all". */
  readonly action?: ReactNode;
  readonly children: ReactNode;
  readonly testID?: string;
}

/** A titled group. Screens stack sections 24 apart; the title sits 12 above its content. */
export function Section({ title, subtitle, action, children, testID }: SectionProps) {
  return (
    <View className="gap-3" testID={testID}>
      <View className="flex-row items-end justify-between gap-3">
        <View className="flex-1 gap-1">
          <Text variant="h3" accessibilityRole="header">
            {title}
          </Text>
          {subtitle ? (
            <Text variant="caption" tone="secondary">
              {subtitle}
            </Text>
          ) : null}
        </View>
        {action ?? null}
      </View>
      {children}
    </View>
  );
}
