'use client';

import { AppShell, Skeleton } from '@clickco/ui-web';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, useEffect } from 'react';
import { canUse, deskOf, navFor } from '../../shared/access';
import { adminApi } from '../../shared/api';
import { keys } from '../../shared/query';
import { updateStaff, useHydrated, useSession } from '../../shared/session';
import { signInPath } from '../../shared/sign-out';
import { NoAccess } from './no-access';
import { PanelNav } from './panel-nav';
import { StaffMenu } from './staff-menu';
import { useIdleSignOut } from './use-idle-sign-out';

const PROFILE_REFRESH_MS = 5 * 60_000;

/**
 * Every desk sits in this frame: it sends a signed-out tab to sign-in, signs out after 30 idle
 * minutes, keeps the profile (roles) fresh from GET /admin/me, and shows only the desks the
 * roles allow (ADR-0025 D3/D6). The API still decides every request.
 */
export function PanelShell({ children }: { readonly children: ReactNode }) {
  const hydrated = useHydrated();
  const session = useSession();
  const router = useRouter();
  const pathname = usePathname();
  useIdleSignOut(session !== null);

  const me = useQuery({
    queryKey: keys.me,
    queryFn: () => adminApi.me(),
    enabled: session !== null,
    refetchInterval: PROFILE_REFRESH_MS,
  });

  useEffect(() => {
    if (me.data) updateStaff(me.data);
  }, [me.data]);

  useEffect(() => {
    if (hydrated && session === null) router.replace(signInPath(null, pathname));
  }, [hydrated, session, router, pathname]);

  if (!hydrated || session === null) {
    return (
      <div className="grid min-h-svh place-items-center bg-background" aria-busy="true">
        <Skeleton className="h-8 w-48" />
      </div>
    );
  }

  const staff = me.data ?? session.staff;
  const desk = deskOf(pathname);
  const allowed = desk === null || canUse(staff.grants, desk);

  return (
    <AppShell
      location={pathname}
      brand={
        <Link href="/" className="flex items-center gap-2 font-bold font-display text-lg">
          <span aria-hidden="true" className="size-3 rounded-full bg-primary" />
          Clickco Admin
        </Link>
      }
      nav={<PanelNav entries={navFor(staff.grants)} pathname={pathname} />}
      header={
        <>
          <span className="truncate text-muted-foreground text-sm">Operations</span>
          <StaffMenu staff={staff} />
        </>
      }
    >
      {allowed ? children : <NoAccess />}
    </AppShell>
  );
}
