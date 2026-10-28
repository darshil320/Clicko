'use client';

import { EmptyState, ShieldAlertIcon } from '@clickco/ui-web';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { homeFor } from '../../shared/access';
import { useSession } from '../../shared/session';

/** `/`: go to the first desk the roles allow. */
export function Home() {
  const session = useSession();
  const router = useRouter();
  const home = session ? homeFor(session.staff.grants) : null;

  useEffect(() => {
    if (home) router.replace(home);
  }, [home, router]);

  if (session && !home) {
    return (
      <EmptyState
        icon={<ShieldAlertIcon />}
        title="No desks yet"
        description="Your account has no roles. Ask a super admin to grant one."
      />
    );
  }
  return null;
}
