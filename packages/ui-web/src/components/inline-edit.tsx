'use client';

import { PencilIcon } from 'lucide-react';
import * as React from 'react';
import { cn } from '../lib/cn.js';
import { Spinner } from './spinner.js';

export interface InlineEditProps {
  /** What the cell shows when not editing ("₹4,250"). */
  readonly display: React.ReactNode;
  /** The text the input starts with when editing ("4250"). */
  readonly initial: string;
  /** Accessible name: "Hourly rate, Professional, Tier 1 cities". */
  readonly label: string;
  /** Saves the text: resolve with null when saved, or an error message to show. */
  readonly onCommit: (text: string) => Promise<string | null>;
  readonly prefix?: string;
  readonly suffix?: string;
  readonly disabled?: boolean;
  /** Marks the value as changed (e.g. against the live rate card). */
  readonly changed?: boolean;
  readonly inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
  readonly className?: string;
}

/**
 * A table cell you click to edit in place (the Stripe/Linear pattern): Enter or leaving the field
 * saves, Escape cancels, the cell shows a spinner while saving and the error under it if the save
 * was refused. Read-only (`disabled`) it is plain text. Fully keyboard operable.
 */
function InlineEdit({
  display,
  initial,
  label,
  onCommit,
  prefix,
  suffix,
  disabled = false,
  changed = false,
  inputMode = 'decimal',
  className,
}: InlineEditProps) {
  const [editing, setEditing] = React.useState(false);
  const [text, setText] = React.useState(initial);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const errorId = React.useId();

  const start = () => {
    setText(initial);
    setError(null);
    setEditing(true);
  };

  const commit = async () => {
    if (saving) return;
    if (text.trim() === initial.trim()) {
      setEditing(false);
      return;
    }
    setSaving(true);
    const problem = await onCommit(text);
    setSaving(false);
    setError(problem);
    if (problem === null) setEditing(false);
  };

  if (disabled) {
    return (
      <span className={cn('tabular-nums', changed && 'font-semibold', className)}>{display}</span>
    );
  }

  if (!editing) {
    return (
      <button
        type="button"
        data-slot="inline-edit"
        aria-label={`Edit ${label}`}
        onClick={start}
        className={cn(
          'group inline-flex cursor-pointer items-center gap-1.5 rounded-sm px-1 py-0.5 tabular-nums outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50',
          changed && 'font-semibold',
          className,
        )}
      >
        {display}
        <PencilIcon
          aria-hidden="true"
          className="size-3 text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"
        />
      </button>
    );
  }

  return (
    <div className="grid gap-1">
      <div className="inline-flex items-center gap-1">
        {prefix ? <span className="text-muted-foreground">{prefix}</span> : null}
        <input
          // biome-ignore lint/a11y/noAutofocus: the person just asked to edit this cell
          autoFocus
          aria-label={label}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          inputMode={inputMode}
          value={text}
          disabled={saving}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => void commit()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void commit();
            }
            if (e.key === 'Escape') {
              e.preventDefault();
              setError(null);
              setEditing(false);
            }
          }}
          className="h-8 w-24 rounded-md border border-input bg-card px-2 text-right text-sm tabular-nums shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive"
        />
        {suffix ? <span className="text-muted-foreground">{suffix}</span> : null}
        {saving ? <Spinner /> : null}
      </div>
      {error ? (
        <p
          id={errorId}
          role="alert"
          className="max-w-48 whitespace-normal text-destructive text-sm"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}

export { InlineEdit };
