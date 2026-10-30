'use client';

import type { AdminStaffRow } from '@clickco/contracts';
import {
  Badge,
  Button,
  type ColumnDef,
  DataTable,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  PageHeader,
  RefreshCwIcon,
  RelativeTime,
  UserPlusIcon,
  XIcon,
} from '@clickco/ui-web';
import { useMemo, useState } from 'react';
import { grantLabel } from '../../shared/access';
import { adminApi } from '../../shared/api';
import { Muted } from '../../shared/cells';
import { useCities } from '../../shared/cities';
import { formatDateTime } from '../../shared/format';
import { usePagedList } from '../../shared/paged';
import { keys } from '../../shared/query';
import { useSession } from '../../shared/session';
import { useNow } from '../../shared/use-now';
import { CreateStaffDialog } from './create-staff-dialog';
import { GrantDialog } from './grant-dialog';
import { ResetPasswordDialog } from './reset-password-dialog';
import { canDeactivate, canRevoke } from './rules';
import { type StaffAction, StaffActionDialog } from './staff-actions';

const PAGE_SIZE = 100;

/** ADR-0026 D7: a temporary password still to be replaced, or one that ran out. */
function PasswordBadge({ row, now }: { readonly row: AdminStaffRow; readonly now: number }) {
  if (!row.temporaryPasswordExpiresAt) return null;
  const expired = Date.parse(row.temporaryPasswordExpiresAt) <= now;
  return expired ? (
    <Badge variant="destructive">Temporary password expired</Badge>
  ) : (
    <Badge variant="warning">
      Temporary password · ends <RelativeTime at={row.temporaryPasswordExpiresAt} now={now} />
    </Badge>
  );
}

function columns(
  myId: string,
  now: number,
  act: (action: StaffAction) => void,
  addRole: (staff: AdminStaffRow) => void,
  resetPassword: (staff: AdminStaffRow) => void,
): ReadonlyArray<ColumnDef<AdminStaffRow>> {
  return [
    {
      id: 'name',
      header: 'Person',
      accessorFn: (row) => row.fullName,
      cell: ({ row }) => (
        <div className="grid">
          <span className="font-medium">
            {row.original.fullName}
            {row.original.id === myId ? <Muted> (you)</Muted> : null}
          </span>
          <Muted>{row.original.email}</Muted>
        </div>
      ),
    },
    {
      id: 'state',
      header: 'Account',
      accessorFn: (row) => (row.isActive ? 0 : 1),
      cell: ({ row }) => (
        <div className="flex flex-wrap gap-1">
          <Badge variant={row.original.isActive ? 'success' : 'neutral'}>
            {row.original.isActive ? 'Active' : 'Deactivated'}
          </Badge>
          <Badge variant={row.original.totpEnrolled ? 'outline' : 'warning'}>
            {row.original.totpEnrolled ? 'Authenticator set' : 'No authenticator yet'}
          </Badge>
          <PasswordBadge row={row.original} now={now} />
        </div>
      ),
    },
    {
      id: 'roles',
      header: 'Roles',
      enableSorting: false,
      cell: ({ row }) => (
        <div className="flex max-w-md flex-wrap gap-1">
          {row.original.grants.length === 0 ? <Muted>No roles</Muted> : null}
          {row.original.grants.map((grant) => (
            <Badge key={grant.id} variant="outline" className="gap-1 pr-1">
              {grantLabel(grant)}
              {canRevoke(row.original, grant, myId) ? (
                <button
                  type="button"
                  aria-label={`Remove ${grantLabel(grant)} from ${row.original.fullName}`}
                  className="cursor-pointer rounded-full p-0.5 hover:bg-muted focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  onClick={() => act({ kind: 'revoke', staff: row.original, grant })}
                >
                  <XIcon className="size-3" />
                </button>
              ) : null}
            </Badge>
          ))}
        </div>
      ),
    },
    {
      id: 'lastLogin',
      header: 'Last sign-in',
      accessorFn: (row) => (row.lastLoginAt ? Date.parse(row.lastLoginAt) : 0),
      cell: ({ row }) =>
        row.original.lastLoginAt ? (
          <span title={formatDateTime(row.original.lastLoginAt)}>
            <RelativeTime at={row.original.lastLoginAt} now={now} />
          </span>
        ) : (
          <Muted>Never</Muted>
        ),
    },
    {
      id: 'actions',
      header: () => <span className="sr-only">Actions</span>,
      enableSorting: false,
      cell: ({ row }) =>
        row.original.isActive ? (
          <div className="flex justify-end">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" aria-label={`Manage ${row.original.fullName}`}>
                  Manage
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => addRole(row.original)}>
                  Add a role
                </DropdownMenuItem>
                {row.original.id !== myId ? (
                  <DropdownMenuItem onSelect={() => resetPassword(row.original)}>
                    Reset password
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem onSelect={() => act({ kind: 'reset-totp', staff: row.original })}>
                  Reset authenticator
                </DropdownMenuItem>
                {canDeactivate(row.original, myId) ? (
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={() => act({ kind: 'deactivate', staff: row.original })}
                  >
                    Deactivate
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : null,
    },
  ];
}

/** Staff management (ADR-0025 D5, SUPER_ADMIN only). */
export function StaffDesk() {
  const session = useSession();
  const myId = session?.staff.id ?? '';
  const [creating, setCreating] = useState(false);
  const [granting, setGranting] = useState<AdminStaffRow | null>(null);
  const [action, setAction] = useState<StaffAction | null>(null);
  const [resetting, setResetting] = useState<AdminStaffRow | null>(null);
  const now = useNow();
  const list = usePagedList(keys.staff, (cursor) =>
    adminApi.staff.list({ cursor, limit: PAGE_SIZE }),
  );

  const cities = useCities();
  const cols = useMemo(() => columns(myId, now, setAction, setGranting, setResetting), [myId, now]);

  return (
    <>
      <PageHeader
        title="Staff"
        description="Who can use the panel, and which desks their roles open. Every change is audited."
        actions={
          <>
            <Button variant="outline" onClick={list.retry} disabled={list.isRefreshing}>
              <RefreshCwIcon />
              Refresh
            </Button>
            <Button onClick={() => setCreating(true)}>
              <UserPlusIcon />
              Add staff
            </Button>
          </>
        }
      />
      <DataTable
        caption="Staff"
        columns={cols}
        data={list.rows}
        getRowId={(row) => row.id}
        isLoading={list.isLoading}
        error={list.error}
        onRetry={list.retry}
        emptyTitle="No staff yet"
        emptyDescription="Add the first colleague."
        emptyAction={<Button onClick={() => setCreating(true)}>Add staff</Button>}
        hasMore={list.hasMore}
        isLoadingMore={list.isLoadingMore}
        onLoadMore={list.loadMore}
      />
      {creating ? <CreateStaffDialog cities={cities} onClose={() => setCreating(false)} /> : null}
      {granting ? (
        <GrantDialog
          key={granting.id}
          staff={granting}
          cities={cities}
          onClose={() => setGranting(null)}
        />
      ) : null}
      {action ? <StaffActionDialog action={action} onClose={() => setAction(null)} /> : null}
      {resetting ? (
        <ResetPasswordDialog
          key={resetting.id}
          staff={resetting}
          onClose={() => setResetting(null)}
        />
      ) : null}
    </>
  );
}
