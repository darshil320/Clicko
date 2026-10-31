'use client';

import type { AdminResetPasswordResponse, AdminStaffRow } from '@clickco/contracts';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  CopyField,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  KeyRoundIcon,
  Spinner,
  toast,
} from '@clickco/ui-web';
import { useState } from 'react';
import { adminApi } from '../../shared/api';
import { formatDateTime } from '../../shared/format';
import { useAdminMutation } from '../../shared/mutation';
import { keys } from '../../shared/query';
import { stepUpCodeIssue, stepUpError } from './rules';
import { StepUpCodeField } from './step-up-code-field';

/**
 * ADR-0026 D7 (SUPER_ADMIN): a new temporary password for someone locked out. The confirm says
 * what happens; the password is then shown once, valid 72 hours, and dropped from memory when
 * the dialog closes. Their sessions end at once.
 */
export function ResetPasswordDialog({
  staff,
  onClose,
}: {
  readonly staff: AdminStaffRow;
  readonly onClose: () => void;
}) {
  const [result, setResult] = useState<AdminResetPasswordResponse | null>(null);
  const [code, setCode] = useState('');
  const [touched, setTouched] = useState(false);
  const reset = useAdminMutation({
    // No Idempotency-Key: the answer is a secret and must never sit in a replay store.
    // A fresh authenticator code is required (step-up, audit M3).
    run: (vars: { staffId: string; code: string }) =>
      adminApi.staff.resetPassword(vars.staffId, vars.code),
    success: () => `New temporary password for ${staff.fullName}`,
    invalidate: [keys.staff],
    onSuccess: setResult,
  });

  const submit = () => {
    setTouched(true);
    if (stepUpCodeIssue(code) === null) reset.mutate({ staffId: staff.id, code });
  };

  const close = () => {
    setResult(null);
    setCode('');
    reset.reset();
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => (!open && !reset.isPending ? close() : undefined)}>
      <DialogContent>
        {result ? (
          <div className="grid gap-4">
            <DialogHeader>
              <DialogTitle>Send this to {staff.fullName}</DialogTitle>
              <DialogDescription>
                Over a private channel. It works until {formatDateTime(result.expiresAt)} (72
                hours); at sign-in they choose their own password.
              </DialogDescription>
            </DialogHeader>
            <Alert variant="warning">
              <KeyRoundIcon />
              <AlertTitle>Shown only once</AlertTitle>
              <AlertDescription>
                <p>Copy it now. Closing this window hides it for good.</p>
              </AlertDescription>
            </Alert>
            <CopyField
              label="temporary password"
              value={result.temporaryPassword}
              onCopyFailed={() => toast.error('Copy did not work — select the password instead')}
            />
            <DialogFooter>
              <Button onClick={close}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="grid gap-4">
            <DialogHeader>
              <DialogTitle>Reset {staff.fullName}’s password?</DialogTitle>
              <DialogDescription>
                Their current password stops working and they are signed out everywhere. You get a
                temporary password to send them; it lasts 72 hours. Their authenticator stays as it
                is.
              </DialogDescription>
            </DialogHeader>
            <StepUpCodeField
              id="reset-password-code"
              value={code}
              onChange={setCode}
              disabled={reset.isPending}
              error={(touched ? stepUpCodeIssue(code) : null) ?? stepUpError(reset.error)}
            />
            <DialogFooter>
              <Button variant="outline" onClick={close} disabled={reset.isPending}>
                Cancel
              </Button>
              <Button onClick={submit} disabled={reset.isPending}>
                {reset.isPending ? <Spinner /> : null}
                Reset password
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
