'use client';

import { MEDIA_LIMITS } from '@clickco/contracts';
import { JobList } from '../../src/features/jobs/job-list';
import { useRequireSession } from '../../src/shared/hooks';
import { Loading } from '../../src/shared/ui';

export default function JobsPage() {
  const session = useRequireSession();
  if (!session) return <Loading />;
  const firstName = session.photographer.displayName.trim().split(/\s+/)[0] ?? '';
  return (
    <div className="page">
      <header className="page-head reveal">
        <div>
          <span className="eyebrow">
            {firstName ? `Welcome back, ${firstName}` : 'Welcome back'}
          </span>
          <h1>Your shoots</h1>
          <p className="lede">
            Upload every RAW and JPEG from the card within {MEDIA_LIMITS.uploadDeadlineHours} hours
            of checking out.
          </p>
        </div>
      </header>
      <JobList />
    </div>
  );
}
