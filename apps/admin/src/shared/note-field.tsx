'use client';

import { Field, Textarea } from '@clickco/ui-web';

export const NOTE_MAX = 1_000;

/** A note for the audit log (and, for a QA fail, the photographer). */
export function NoteField({
  id,
  label,
  value,
  onChange,
  error,
  hint,
  required = false,
}: {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly error: string | null;
  readonly hint?: string;
  readonly required?: boolean;
}) {
  return (
    <Field label={required ? label : `${label} (optional)`} htmlFor={id} hint={hint} error={error}>
      <Textarea
        id={id}
        rows={4}
        maxLength={NOTE_MAX}
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
      />
    </Field>
  );
}

/** The first contract error for a field, or null. */
export function fieldError(
  result:
    | { success: true }
    | {
        success: false;
        error: { issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }> };
      },
  field: string,
): string | null {
  if (result.success) return null;
  return result.error.issues.find((i) => i.path[0] === field)?.message ?? null;
}
