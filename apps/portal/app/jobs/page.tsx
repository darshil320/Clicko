'use client';

import { JobList } from '../../src/features/jobs/job-list';
import { useRequireSession } from '../../src/shared/hooks';

export default function JobsPage() {
  const session = useRequireSession();
  if (!session) return <p className="muted">Loading…</p>;
  return (
    <div className="stack">
      <div>
        <h1>Your shoots</h1>
        <p className="muted">
          Upload every RAW and JPEG from the card within 6 hours of checking out.
        </p>
      </div>
      <JobList />
    </div>
  );
}
