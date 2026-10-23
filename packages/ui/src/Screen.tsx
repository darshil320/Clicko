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

export interface ScreenProps {
  readonly children: ReactNode;
  /** Non-scrolling content above the body (a compact header). */
  readonly header?: ReactNode;
  /** Pinned to the bottom, 16px above the safe-area inset — the primary CTA lives here. */
  readonly footer?: ReactNode;
  readonly scroll?: boolean;
  /** Under a navigator header the top inset is already handled. */
  readonly topInset?: boolean;
  readonly refreshControl?: ReactElement<RefreshControlProps>;
  readonly testID?: string;
}

/** Safe-area screen frame: surface/base, 20px horizontal padding, optional pinned footer. */
export function Screen({
  children,
  header,
  footer,
  scroll = true,
  topInset = true,
  refreshControl,
  testID,
}: ScreenProps) {
  const insets = useSafeAreaInsets();
  const body = cx('gap-4 px-5 pt-4', footer ? 'pb-6' : 'pb-10');

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      className="flex-1 bg-surface-base"
      style={{ paddingTop: topInset ? insets.top : 0 }}
      testID={testID}
    >
      {header ? <View className="px-5 pt-2">{header}</View> : null}
      {scroll ? (
        <ScrollView
          className="flex-1"
          contentContainerClassName={body}
          keyboardShouldPersistTaps="handled"
          refreshControl={refreshControl}
        >
          {children}
        </ScrollView>
      ) : (
        <View className={cx('flex-1', body)}>{children}</View>
      )}
      {footer ? (
        <View
          className="gap-3 border-t border-border-subtle bg-surface-base px-5 pt-3"
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
