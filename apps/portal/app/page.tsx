'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { loadSession } from '../src/shared/session';
import { Loading } from '../src/shared/ui';

export default function Home() {
  const router = useRouter();
  useEffect(() => {
    router.replace(loadSession() ? '/jobs' : '/login');
  }, [router]);
  return <Loading />;
}
