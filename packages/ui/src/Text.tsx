import type { ReactNode } from 'react';
import { Platform, Text as RNText, type TextProps as RNTextProps } from 'react-native';
import { cx } from './cx';
import { fontFaceFor, type TextVariant } from './fonts';
import { TEXT_TONE_CLASS, type Tone } from './tones';

export type { TextVariant } from './fonts';

const VARIANT_CLASS: Readonly<Record<TextVariant, string>> = {
  display: 'text-display',
  h1: 'text-h1',
  h2: 'text-h2',
  h3: 'text-h3',
  body: 'text-body',
  bodyStrong: 'text-bodyStrong',
  caption: 'text-caption',
  micro: 'text-micro uppercase tracking-micro',
};

const ALIGN_CLASS = { left: 'text-left', center: 'text-center', right: 'text-right' } as const;

export interface TextProps extends Omit<RNTextProps, 'style'> {
  readonly variant?: TextVariant;
  readonly tone?: Tone;
  /** Tabular numerals — every price and timer (DESIGN.md §Typography). */
  readonly tabular?: boolean;
  readonly align?: keyof typeof ALIGN_CLASS;
  readonly strike?: boolean;
  readonly className?: string;
  readonly children?: ReactNode;
}

/**
 * The one way to put text on screen. The face is chosen per weight ("Inter-SemiBold"); on
 * web the browser would otherwise synthesise bold on top of an already-bold face.
 */
export function Text({
  variant = 'body',
  tone = 'primary',
  tabular = false,
  align,
  strike = false,
  className,
  children,
  ...rest
}: TextProps) {
  return (
    <RNText
      className={cx(
        VARIANT_CLASS[variant],
        TEXT_TONE_CLASS[tone],
        tabular && 'tabular-nums',
        strike && 'line-through',
        align && ALIGN_CLASS[align],
        className,
      )}
      style={{
        fontFamily: fontFaceFor(variant),
        ...(Platform.OS === 'web' ? { fontWeight: 'normal' } : {}),
      }}
      {...rest}
    >
      {children}
    </RNText>
  );
}
