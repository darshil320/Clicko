'use client';

import type { AdminPayoutFile } from '@clickco/contracts';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Spinner,
} from '@clickco/ui-web';
import type { ReactNode } from 'react';

/** Query keys for this desk (kept here: the shared key list belongs to the shell). */
export const payoutKeys = {
  all: ['payouts'] as const,
  due: ['payouts', 'due'] as const,
  batches: ['payouts', 'batches'] as const,
  batch: (id: string) => ['payouts', 'batch', id] as const,
  tds: (fy: string | null) => ['payouts', 'tds', fy] as const,
};

/** Saves a CSV the API sent in its envelope. Nothing is kept in the page afterwards. */
export function saveFile(file: AdminPayoutFile): void {
  const blob = new Blob([file.content], { type: `${file.contentType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.filename;
  document.body.append(a);
  a.click();
  a.remove();
  // Revoked a moment later: revoking at once can cancel the download in some browsers.
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

/** A confirm step that says what will happen with the money (ADR-0026 D8). */
export function Confirm({
  title,
  description,
  confirmLabel,
  pending,
  destructive = false,
  onConfirm,
  onClose,
}: {
  readonly title: string;
  readonly description: ReactNode;
  readonly confirmLabel: string;
  readonly pending: boolean;
  readonly destructive?: boolean;
  readonly onConfirm: () => void;
  readonly onClose: () => void;
}) {
  return (
    <AlertDialog open onOpenChange={(open) => (!open && !pending ? onClose() : undefined)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <Button
            variant={destructive ? 'destructive' : 'default'}
            onClick={onConfirm}
            disabled={pending}
          >
            {pending ? <Spinner /> : null}
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
