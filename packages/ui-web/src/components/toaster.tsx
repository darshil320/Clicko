'use client';

import type * as React from 'react';
import { Toaster as Sonner, type ToasterProps, toast } from 'sonner';

/**
 * Notices (sonner) in the kit's colours. Sonner's own stylesheet is imported statically by
 * styles.css, so it loads under the nonce CSP as a same-origin file.
 */
function Toaster(props: ToasterProps) {
  return (
    <Sonner
      theme="light"
      position="bottom-right"
      richColors={false}
      closeButton
      className="toaster group"
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
          '--border-radius': 'var(--cc-radius-md)',
        } as React.CSSProperties
      }
      {...props}
    />
  );
}

export { Toaster, toast };
