'use client';

import type { AdminStaffRow, StaffGrant } from '@clickco/contracts';
import { grantLabel } from '../../shared/access';
import { adminApi } from '../../shared/api';
import { useAdminMutation } from '../../shared/mutation';
import { keys } from '../../shared/query';
import { ConfirmAction } from './confirm-action';

export type StaffAction =
  | { readonly kind: 'revoke'; readonly staff: AdminStaffRow; readonly grant: StaffGrant }
  | { readonly kind: 'deactivate'; readonly staff: AdminStaffRow }
  | { readonly kind: 'reset-totp'; readonly staff: AdminStaffRow };

/** The confirm step and the call for revoke / deactivate / reset TOTP. */
export function StaffActionDialog({
  action,
  onClose,
}: {
  readonly action: StaffAction;
  readonly onClose: () => void;
}) {
  const name = action.staff.fullName;
  const mutation = useAdminMutation({
    run: (a: StaffAction, idem) => {
      if (a.kind === 'revoke') return adminApi.staff.revokeGrant(a.staff.id, a.grant.id, idem);
      if (a.kind === 'deactivate') return adminApi.staff.deactivate(a.staff.id, idem);
      return adminApi.staff.resetTotp(a.staff.id, idem);
    },
    success: (a) =>
      a.kind === 'revoke'
        ? `${grantLabel(a.grant)} removed from ${name}`
        : a.kind === 'deactivate'
          ? `${name} is deactivated and signed out`
          : `${name} sets up a new authenticator at next sign-in`,
    invalidate: [keys.staff],
    onSuccess: onClose,
  });
  const run = () => mutation.mutate(action);

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
      />
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
    />
  );
}
