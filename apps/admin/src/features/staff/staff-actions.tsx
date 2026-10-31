'use client';

import type { AdminStaffRow, StaffGrant } from '@clickco/contracts';
import { useState } from 'react';
import { grantLabel } from '../../shared/access';
import { adminApi } from '../../shared/api';
import { useAdminMutation } from '../../shared/mutation';
import { keys } from '../../shared/query';
import { ConfirmAction } from './confirm-action';
import { stepUpCodeIssue, stepUpError } from './rules';
import { StepUpCodeField } from './step-up-code-field';

export type StaffAction =
  | { readonly kind: 'revoke'; readonly staff: AdminStaffRow; readonly grant: StaffGrant }
  | { readonly kind: 'deactivate'; readonly staff: AdminStaffRow }
  | { readonly kind: 'reset-totp'; readonly staff: AdminStaffRow };

/**
 * The confirm step and the call for revoke / deactivate / reset TOTP. Deactivating and resetting
 * an authenticator need a fresh code from the caller's authenticator (audit M3); revoking does not.
 */
export function StaffActionDialog({
  action,
  onClose,
}: {
  readonly action: StaffAction;
  readonly onClose: () => void;
}) {
  const name = action.staff.fullName;
  const [code, setCode] = useState('');
  const [touched, setTouched] = useState(false);
  const mutation = useAdminMutation({
    run: ({ a, code }: { a: StaffAction; code: string }, idem) => {
      if (a.kind === 'revoke') return adminApi.staff.revokeGrant(a.staff.id, a.grant.id, idem);
      if (a.kind === 'deactivate') return adminApi.staff.deactivate(a.staff.id, code, idem);
      return adminApi.staff.resetTotp(a.staff.id, code, idem);
    },
    success: ({ a }) =>
      a.kind === 'revoke'
        ? `${grantLabel(a.grant)} removed from ${name}`
        : a.kind === 'deactivate'
          ? `${name} is deactivated and signed out`
          : `${name} sets up a new authenticator at next sign-in`,
    invalidate: [keys.staff],
    onSuccess: onClose,
  });
  const run = () => {
    setTouched(true);
    if (action.kind !== 'revoke' && stepUpCodeIssue(code) !== null) return;
    mutation.mutate({ a: action, code });
  };
  const codeField = (
    <StepUpCodeField
      id="staff-action-code"
      value={code}
      onChange={setCode}
      disabled={mutation.isPending}
      error={(touched ? stepUpCodeIssue(code) : null) ?? stepUpError(mutation.error)}
    />
  );

  if (action.kind === 'revoke') {
    return (
      <ConfirmAction
        title={`Remove ${grantLabel(action.grant)} from ${name}?`}
        description="They lose the desks this role gives them on their next request."
        confirmLabel="Remove role"
        pending={mutation.isPending}
        onConfirm={run}
        onClose={onClose}
      />
    );
  }
  if (action.kind === 'deactivate') {
    return (
      <ConfirmAction
        title={`Deactivate ${name}?`}
        description="They are signed out everywhere and can no longer sign in."
        confirmLabel="Deactivate"
        pending={mutation.isPending}
        onConfirm={run}
        onClose={onClose}
      >
        {codeField}
      </ConfirmAction>
    );
  }
  return (
    <ConfirmAction
      title={`Reset ${name}'s authenticator?`}
      description="Their current authenticator stops working. They set up a new one at their next sign-in."
      confirmLabel="Reset authenticator"
      pending={mutation.isPending}
      onConfirm={run}
      onClose={onClose}
    >
      {codeField}
    </ConfirmAction>
  );
}
