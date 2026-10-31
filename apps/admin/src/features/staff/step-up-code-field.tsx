'use client';

import { Field, Input } from '@clickco/ui-web';
import { codeDigits } from './rules';

/**
 * The 6-digit authenticator code a high-risk staff change needs (audit M3), composed from the
 * kit exactly as the pricing publish dialog's code field (ADR-0026 D4).
 */
export function StepUpCodeField({
  id,
  value,
  onChange,
  error,
  disabled,
}: {
  readonly id: string;
  readonly value: string;
  readonly onChange: (code: string) => void;
  readonly error: string | null;
  readonly disabled?: boolean;
}) {
  return (
    <Field
      label="Code from your authenticator app"
      htmlFor={id}
      hint="Changing staff access needs a fresh code, even though you are signed in."
      error={error}
    >
      <Input
        id={id}
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        placeholder="123456"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(codeDigits(e.target.value))}
        aria-invalid={error ? true : undefined}
      />
    </Field>
  );
}
