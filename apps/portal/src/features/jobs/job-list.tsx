'use client';

import { MEDIA_LIMITS, type ProUploadJob } from '@clickco/contracts';
import { useEffect, useState } from 'react';
import { errorMessage } from '../../shared/api';
import { formatBytes, formatCountdown } from '../../shared/format';
import { useNow } from '../../shared/hooks';
import { listUploadJobs } from '../../shared/jobs-api';

const AWAITING: ReadonlySet<string> = new Set(['CHECKED_OUT', 'UPLOADING']);

const STATUS_LABEL: Readonly<Record<string, { label: string; tone: string }>> = {
  CHECKED_OUT: { label: 'Awaiting upload', tone: 'warn' },
  UPLOADING: { label: 'Uploading', tone: 'warn' },
  PROCESSING: { label: 'Processing', tone: 'idle' },
  QA: { label: 'In QA', tone: 'ok' },
};

function Deadline({ job, now }: { readonly job: ProUploadJob; readonly now: number }) {
  if (!job.uploadDeadlineAt)
    return <span className="muted small">Deadline unknown — contact ops</span>;
  const { text, overdue } = formatCountdown(Date.parse(job.uploadDeadlineAt), now);
  return <span className={overdue ? 'overdue countdown' : 'countdown'}>{text}</span>;
}

function JobCard({ job, now }: { readonly job: ProUploadJob; readonly now: number }) {
  const status = STATUS_LABEL[job.bookingStatus] ?? { label: job.bookingStatus, tone: 'idle' };
  const awaiting = AWAITING.has(job.bookingStatus);
  const session = job.activeSession;
  return (
    <div className="card stack">
      <div className="spread">
        <div>
          <strong>{job.bookingReference}</strong>{' '}
          <span className="muted">
            · {job.categoryCode} · {job.tier} · shot{' '}
            {new Date(job.scheduledStart).toLocaleDateString('en-IN', { dateStyle: 'medium' })}
          </span>
        </div>
        <span className={`pill ${status.tone}`}>{status.label}</span>
      </div>
      {awaiting ? (
        <div className="spread">
          <div className="stack">
            <span>
              Upload deadline: <Deadline job={job} now={now} />
            </span>
            <span className="muted small">
              {MEDIA_LIMITS.uploadDeadlineHours} hours from check-out. A late upload counts against
              your on-time rate (it affects the offers you get) and Clickco ops will call you.
            </span>
            {session ? (
              <span className="small">
                In progress: {session.receivedFileCount} of {session.declaredFileCount} files ·{' '}
                {formatBytes(session.receivedBytes)} of {formatBytes(session.declaredBytes)}
              </span>
            ) : null}
          </div>
          <a className="button" href={`/jobs/${job.bookingId}/upload`}>
            {session ? 'Resume upload' : 'Upload photos'}
          </a>
        </div>
      ) : (
        <div className="spread">
          <span className="muted small">
            {job.media.rawFiles} RAW · {job.media.jpegFiles} JPEG ·{' '}
            {formatBytes(job.media.uploadedBytes)} uploaded
          </span>
          <a className="button secondary" href={`/jobs/${job.bookingId}/status`}>
            View status
          </a>
        </div>
      )}
    </div>
  );
}

/** Jobs awaiting upload, with a live countdown to check-out + 6 h (doc 02 §7). */
export function JobList() {
  const now = useNow(1_000);
  const [jobs, setJobs] = useState<readonly ProUploadJob[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const load = () =>
      listUploadJobs()
        .then((j) => live && setJobs(j))
        .catch((e: unknown) => live && setError(errorMessage(e)));
    void load();
    const id = setInterval(load, 30_000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, []);

  if (error) return <p className="err">{error}</p>;
  if (jobs === null) return <p className="muted">Loading your jobs…</p>;
  if (jobs.length === 0) {
    return (
      <div className="card">
        <p>No shoots are waiting for an upload.</p>
        <p className="muted small">
          A job appears here as soon as you check out of a shoot in the Pro app.
        </p>
      </div>
    );
  }
  return (
    <div>
      {jobs.map((job) => (
        <JobCard key={job.bookingId} job={job} now={now} />
      ))}
    </div>
  );
}
