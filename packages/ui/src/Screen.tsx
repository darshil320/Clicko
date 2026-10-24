import { layout } from '@clickco/design-tokens';
import type { ReactElement, ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  type RefreshControlProps,
  ScrollView,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { cx } from './cx';
import { Reveal } from './Reveal';
import { Text } from './Text';

export interface ScreenProps {
  readonly children: ReactNode;
  /** Non-scrolling content above the body (a compact header, a segmented control). */
  readonly header?: ReactNode;
  /** A small uppercase line above the title, e.g. "Step 2 of 4". */
  readonly eyebrow?: string;
  /** A confident page title at the top of the scrolling body. */
  readonly title?: string;
  /** One calm line under the title. */
  readonly subtitle?: string;
  /** "display" (32) for tab roots; "h1" (24) under a navigator header. */
  readonly titleVariant?: 'display' | 'h1';
  /** Pinned to the bottom, 16px above the safe-area inset — the primary CTA lives here. */
  readonly footer?: ReactNode;
  readonly scroll?: boolean;
  /** Under a navigator header the top inset is already handled. */
  readonly topInset?: boolean;
  readonly refreshControl?: ReactElement<RefreshControlProps>;
  readonly testID?: string;
}

function TitleBlock({
  eyebrow,
  title,
  subtitle,
  titleVariant,
}: Pick<ScreenProps, 'eyebrow' | 'title' | 'subtitle' | 'titleVariant'>) {
  if (!eyebrow && !title && !subtitle) return null;
  return (
    <View className="gap-2">
      {eyebrow ? (
        <Text variant="micro" tone="tertiary">
          {eyebrow}
        </Text>
      ) : null}
      {title ? (
        <Text variant={titleVariant ?? 'display'} accessibilityRole="header">
          {title}
        </Text>
      ) : null}
      {subtitle ? <Text tone="secondary">{subtitle}</Text> : null}
    </View>
  );
}

/**
 * Safe-area screen frame (DESIGN-LIGHT §Whitespace): white, 20px sides, 24px between groups,
 * an optional title block, and an optional pinned footer. The body fades and rises in once.
 */
export function Screen({
  children,
  header,
  eyebrow,
  title,
  subtitle,
  titleVariant,
  footer,
  scroll = true,
  topInset = true,
  refreshControl,
  testID,
}: ScreenProps) {
  const insets = useSafeAreaInsets();
  const padding = cx('px-5 pt-4', footer ? 'pb-8' : 'pb-12');
  const body = (
    <Reveal className="gap-6">
      <TitleBlock eyebrow={eyebrow} title={title} subtitle={subtitle} titleVariant={titleVariant} />
      {children}
    </Reveal>
  );

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      className="flex-1 bg-surface-base"
      style={{ paddingTop: topInset ? insets.top : 0 }}
      testID={testID}
    >
      {header ? <View className="px-5 pt-3 pb-2">{header}</View> : null}
      {scroll ? (
        <ScrollView
          className="flex-1"
          contentContainerClassName={padding}
          keyboardShouldPersistTaps="handled"
          refreshControl={refreshControl}
        >
          {body}
        </ScrollView>
      ) : (
        <View className={cx('flex-1', padding)}>{body}</View>
      )}
      {footer ? (
        <View
          className="gap-3 border-t border-border-subtle bg-surface-base px-5 pt-4"
          style={{ paddingBottom: insets.bottom + layout.ctaGapAboveInset }}
        >
          {footer}
        </View>
      ) : (
        <View style={{ height: insets.bottom }} />
      )}
    </KeyboardAvoidingView>
  );
}
