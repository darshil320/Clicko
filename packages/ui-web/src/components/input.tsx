import type * as React from 'react';
import { cn } from '../lib/cn.js';

const fieldBase =
  'w-full min-w-0 rounded-md border border-input bg-card px-3 text-base text-foreground shadow-xs outline-none transition-[color,box-shadow] placeholder:text-subtle focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20';

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        fieldBase,
        'h-9 py-1 file:inline-flex file:h-7 file:border-0 file:bg-transparent file:font-medium file:text-sm',
        className,
      )}
      {...props}
    />
  );
}

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(fieldBase, 'field-sizing-content flex min-h-16 py-2', className)}
      {...props}
    />
  );
}

export { Input, Textarea };
