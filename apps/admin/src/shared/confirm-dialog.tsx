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

/**
 * ADR-0026 D8: an irreversible step confirms in plain words — what happens, to whom, how much
 * ("₹2,500 credit for Priya Sharma goes to To settle"), never "Are you sure?".
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  consequence,
  confirmLabel,
  pending,
  destructive = false,
  onConfirm,
  children,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: ReactNode;
  readonly consequence: ReactNode;
  readonly confirmLabel: string;
  readonly pending: boolean;
  readonly destructive?: boolean;
  readonly onConfirm: () => void;
  /** A field the decision needs (a reason), under the consequence. */
  readonly children?: ReactNode;
}) {
  return (
    <AlertDialog open={open} onOpenChange={(next) => (pending ? undefined : onOpenChange(next))}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{consequence}</AlertDialogDescription>
        </AlertDialogHeader>
        {children}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Go back</AlertDialogCancel>
          <Button
            variant={destructive ? 'destructive' : 'default'}
            disabled={pending}
            onClick={onConfirm}
          >
            {pending ? <Spinner /> : null}
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
