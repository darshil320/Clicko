'use client';

import { AppShell, Skeleton } from '@clickco/ui-web';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useState } from 'react';
import { canUse, deskOf, navFor } from '../../shared/access';
import { adminApi } from '../../shared/api';
import { countsByDesk, useOverview } from '../../shared/overview';
import { keys } from '../../shared/query';
import { updateStaff, useHydrated, useSession } from '../../shared/session';
import { signInPath } from '../../shared/sign-out';
import { ChangePasswordDialog } from './change-password-dialog';
import { CommandMenu } from './command-menu';
import { NoAccess } from './no-access';
import { PanelNav } from './panel-nav';
import { SearchButton, usePaletteShortcut } from './search-button';
import { StaffMenu } from './staff-menu';
import { useIdleSignOut } from './use-idle-sign-out';

const PROFILE_REFRESH_MS = 5 * 60_000;

/**
 * Every desk sits in this frame: it sends a signed-out tab to sign-in, signs out after 30 idle
 * minutes, keeps the profile (roles) fresh from GET /admin/me, and shows only the desks the
 * roles allow (ADR-0025 D3/D6). ADR-0026 D8: live counts beside the desks (GET /admin/overview,
 * every minute while visible), ⌘K / Ctrl+K search from anywhere, the navigation as a drawer on
 * tablets and phones, and "Change password" in the account menu. The API still decides every
 * request.
 */
export function PanelShell({ children }: { readonly children: ReactNode }) {
  const hydrated = useHydrated();
  const session = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const [searching, setSearching] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  useIdleSignOut(session !== null);
  usePaletteShortcut(session !== null, () => setSearching((open) => !open));

  const me = useQuery({
    queryKey: keys.me,
    queryFn: () => adminApi.me(),
    enabled: session !== null,
    refetchInterval: PROFILE_REFRESH_MS,
  });
  const staff = me.data ?? session?.staff ?? null;
  const overview = useOverview(staff?.grants ?? null);

  useEffect(() => {
    if (me.data) updateStaff(me.data);
  }, [me.data]);

  useEffect(() => {
    if (hydrated && session === null) router.replace(signInPath(null, pathname));
  }, [hydrated, session, router, pathname]);

  if (!hydrated || session === null || staff === null) {
    return (
      <div className="grid min-h-svh place-items-center bg-background" aria-busy="true">
        <Skeleton className="h-8 w-48" />
      </div>
    );
  }

  const desk = deskOf(pathname);
  const allowed = desk === null || canUse(staff.grants, desk);
  const entries = navFor(staff.grants);

  return (
    <AppShell
      location={pathname}
      brand={
        <Link
          href="/"
          className="flex items-center gap-2 rounded-md font-bold font-display text-lg outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <span aria-hidden="true" className="size-3 rounded-full bg-primary" />
          Clickco Admin
        </Link>
      }
      nav={<PanelNav entries={entries} pathname={pathname} counts={countsByDesk(overview.data)} />}
      header={
        <>
          <SearchButton
            onOpen={() => setSearching(true)}
            canSearchBookings={canUse(staff.grants, 'bookings')}
          />
          <StaffMenu staff={staff} onChangePassword={() => setChangingPassword(true)} />
        </>
      }
    >
      {allowed ? children : <NoAccess />}
      <CommandMenu
        open={searching}
        onOpenChange={setSearching}
        entries={entries}
        canSearchBookings={canUse(staff.grants, 'bookings')}
        onChangePassword={() => setChangingPassword(true)}
      />
      {changingPassword ? (
        <ChangePasswordDialog email={staff.email} onClose={() => setChangingPassword(false)} />
      ) : null}
    </AppShell>
  );
}
