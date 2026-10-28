import type * as React from 'react';
import { cn } from '../lib/cn.js';
import { Label } from './label.js';

/**
 * Form helpers: a label above its control, an optional hint, and the error the server or the
 * contract gave. Pass the control's id as `htmlFor` so the label and error are announced.
 */
export interface FieldProps extends React.ComponentProps<'div'> {
  readonly label: React.ReactNode;
  readonly htmlFor: string;
  readonly hint?: React.ReactNode;
  readonly error?: string | null;
}

function Field({ label, htmlFor, hint, error, className, children, ...props }: FieldProps) {
  return (
    <div data-slot="field" className={cn('grid gap-2', className)} {...props}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && !error ? <p className="text-muted-foreground text-sm">{hint}</p> : null}
      {error ? (
        <p id={`${htmlFor}-error`} role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function FieldRow({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="field-row"
      className={cn('grid gap-4 sm:grid-cols-2 lg:grid-cols-4', className)}
      {...props}
    />
  );
}

export { Field, FieldRow };
