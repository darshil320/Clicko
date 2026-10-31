'use client';

import { Field, Input } from '@clickco/ui-web';

/** Keeps digits only, at most six (what an authenticator app shows). */
export const authenticatorDigits = (raw: string): string => raw.replace(/\D/g, '').slice(0, 6);

/**
 * The fresh 6-digit authenticator code a money action needs (security audit: payouts, large
 * refunds and credits), composed from the kit like the pricing publish dialog's field. `hint`
 * says in plain words why this action asks for it.
 */
export function AuthenticatorCodeField({
  id,
  label = 'Code from your authenticator app',
  hint,
  value,
  onChange,
  error,
  disabled,
}: {
  readonly id: string;
  readonly label?: string;
  readonly hint: string;
  readonly value: string;
  readonly onChange: (code: string) => void;
  readonly error: string | null;
  readonly disabled?: boolean;
}) {
  return (
    <Field label={label} htmlFor={id} hint={hint} error={error}>
      <Input
        id={id}
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        placeholder="123456"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(authenticatorDigits(e.target.value))}
        aria-invalid={error ? true : undefined}
      />
    </Field>
  );
}
