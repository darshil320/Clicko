'use client';

import type { StaffProfile } from '@clickco/contracts';
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  LogOutIcon,
} from '@clickco/ui-web';
import { useState } from 'react';
import { grantLabel } from '../../shared/access';
import { initials } from '../../shared/format';
import { signOut } from '../../shared/sign-out';

/** The header's right side: who is signed in, their roles, and sign out (revokes the session). */
export function StaffMenu({ staff }: { readonly staff: StaffProfile }) {
  const [leaving, setLeaving] = useState(false);
  const roles = staff.grants.map(grantLabel);
  const leave = () => {
    setLeaving(true);
    void signOut('manual');
  };

  return (
    <div className="flex items-center gap-3">
      <div className="hidden items-center gap-1.5 lg:flex">
        {roles.slice(0, 2).map((label) => (
          <Badge key={label} variant="outline">
            {label}
          </Badge>
        ))}
        {roles.length > 2 ? <Badge variant="outline">+{roles.length - 2}</Badge> : null}
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="gap-2 px-2" aria-label={`Account: ${staff.fullName}`}>
            <span
              aria-hidden="true"
              className="flex size-7 items-center justify-center rounded-full bg-accent font-semibold text-accent-foreground text-xs"
            >
              {initials(staff.fullName)}
            </span>
            <span className="hidden text-foreground sm:inline">{staff.fullName}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <div className="grid gap-0.5 px-2 py-1.5">
            <span className="font-semibold text-sm">{staff.fullName}</span>
            <span className="truncate text-muted-foreground text-sm">{staff.email}</span>
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Roles</DropdownMenuLabel>
          <div className="flex flex-wrap gap-1 px-2 pb-2">
            {roles.map((label) => (
              <Badge key={label} variant="outline">
                {label}
              </Badge>
            ))}
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={leaving} onSelect={leave}>
            <LogOutIcon />
            {leaving ? 'Signing out…' : 'Sign out'}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
