'use client';

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

/** A yes/no step before a staff action that cannot be undone from the panel. */
export function ConfirmAction({
  title,
  description,
  confirmLabel,
  pending,
  onConfirm,
  onClose,
  children,
}: {
  readonly title: string;
  readonly description: ReactNode;
  readonly confirmLabel: string;
  readonly pending: boolean;
  readonly onConfirm: () => void;
  readonly onClose: () => void;
  /** Extra input the action needs (the step-up code field, audit M3). */
  readonly children?: ReactNode;
}) {
  return (
    <AlertDialog open onOpenChange={(open) => (!open && !pending ? onClose() : undefined)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {children}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          {/* A plain button: the dialog stays open until the server answers. */}
          <Button variant="destructive" onClick={onConfirm} disabled={pending}>
            {pending ? <Spinner /> : null}
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
