import { color } from '@clickco/design-tokens';
import { type Ref, useState } from 'react';
import { Platform, TextInput, type TextInputProps, View } from 'react-native';
import { cx } from './cx';
import { fontFaceFor } from './fonts';
import { Text } from './Text';

export interface InputProps
  extends Omit<TextInputProps, 'style' | 'className' | 'placeholderTextColor'> {
  readonly label: string;
  readonly error?: string;
  readonly hint?: string;
  /** Fixed text before the value, e.g. "+91". */
  readonly prefix?: string;
  readonly ref?: Ref<TextInput>;
}

function borderClass(focused: boolean, hasError: boolean, editable: boolean): string {
  if (hasError) return 'border-danger';
  if (!editable) return 'border-border-subtle';
  return focused ? 'border-text-secondary' : 'border-border-strong';
}

/** DESIGN.md §Components: surface/raised, 1px border/strong, radius md, height 52. */
export function Input({
  label,
  error,
  hint,
  prefix,
  ref,
  editable = true,
  onFocus,
  onBlur,
  ...rest
}: InputProps) {
  const [focused, setFocused] = useState(false);
  const hasError = error !== undefined && error !== '';

  return (
    <View className="gap-2">
      <Text variant="caption" tone="secondary">
        {label}
      </Text>
      <View
        className={cx(
          'h-input flex-row items-center gap-2 rounded-md border bg-surface-raised px-4',
          borderClass(focused, hasError, editable),
        )}
      >
        {prefix ? (
          <Text variant="body" tone="secondary" tabular>
            {prefix}
          </Text>
        ) : null}
        <TextInput
          ref={ref}
          accessibilityLabel={label}
          accessibilityHint={hasError ? error : hint}
          editable={editable}
          placeholderTextColor={color.text.tertiary}
          selectionColor={color.accent.default}
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          className={cx(
            'h-input flex-1 text-body web:outline-none',
            editable ? 'text-text-primary' : 'text-text-tertiary',
          )}
          style={{
            fontFamily: fontFaceFor('body'),
            ...(Platform.OS === 'web' ? { fontWeight: 'normal' } : {}),
          }}
          {...rest}
        />
      </View>
      {hasError ? (
        <Text variant="caption" tone="danger" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : hint ? (
        <Text variant="caption" tone="tertiary">
          {hint}
        </Text>
      ) : null}
    </View>
  );
}
