'use client';

import { CheckIcon, CopyIcon } from 'lucide-react';
import * as React from 'react';
import { cn } from '../lib/cn.js';
import { Button } from './button.js';

const COPIED_FOR_MS = 2_000;

/**
 * A read-only value with a copy button (a temporary password, a TOTP secret). The value is
 * selectable text too, for browsers that refuse clipboard access.
 */
export interface CopyFieldProps extends React.ComponentProps<'div'> {
  readonly value: string;
  readonly label: string;
  readonly onCopyFailed?: () => void;
}

function CopyField({ value, label, onCopyFailed, className, ...props }: CopyFieldProps) {
  const [copied, setCopied] = React.useState(false);
  React.useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_FOR_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      onCopyFailed?.();
    }
  };

  return (
    <div data-slot="copy-field" className={cn('flex items-stretch gap-2', className)} {...props}>
      <code className="min-w-0 flex-1 select-all break-all rounded-md border border-input bg-muted px-3 py-2 font-mono text-sm">
        <span className="sr-only">{label}: </span>
        {value}
      </code>
      <Button type="button" variant="outline" onClick={copy} aria-label={`Copy ${label}`}>
        {copied ? <CheckIcon /> : <CopyIcon />}
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  );
}

export { CopyField };
