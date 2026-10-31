'use client';

import { MEDIA_LIMITS, type ProUploadJob } from '@clickco/contracts';
import { type ReactNode, useState } from 'react';
import { errorMessage } from '../../shared/api';
import { DeadlineCountdown } from '../../shared/countdown';
import { formatBytes, formatCode, formatDateTime } from '../../shared/format';
import { Icon } from '../../shared/icons';
import { listUploadJobs } from '../../shared/jobs-api';
import { Callout, StatusPill, type Tone } from '../../shared/ui';
import { usePoll } from '../../shared/use-poll';

const POLL_MS = 30_000;

const AWAITING: ReadonlySet<string> = new Set(['CHECKED_OUT', 'UPLOADING']);

const STATUS_LABEL: Readonly<Record<string, { label: string; tone: Tone; live?: boolean }>> = {
  CHECKED_OUT: { label: 'Awaiting upload', tone: 'warn' },
  UPLOADING: { label: 'Uploading', tone: 'warn', live: true },
  PROCESSING: { label: 'Processing', tone: 'idle', live: true },
  QA: { label: 'In QA', tone: 'ok' },
};

function Deadline({ job }: { readonly job: ProUploadJob }) {
  if (!job.uploadDeadlineAt)
    return <span className="muted small">Deadline unknown — contact ops</span>;
  return (
    <>
      <DeadlineCountdown deadlineAt={job.uploadDeadlineAt} />
      <span className="muted small">Due {formatDateTime(job.uploadDeadlineAt)}</span>
    </>
  );
}

function SessionProgress({ job }: { readonly job: ProUploadJob }) {
  const session = job.activeSession;
  if (!session) return null;
  const share =
    session.declaredBytes === 0 ? 0 : (session.receivedBytes / session.declaredBytes) * 100;
  return (
    <div className="mini">
      <div
        className="bar thin neutral"
        role="progressbar"
        aria-label="Upload in progress"
        aria-valuenow={Math.floor(share)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <span style={{ width: `${share}%` }} />
      </div>
      <span className="small muted num">
        {session.receivedFileCount} of {session.declaredFileCount} files ·{' '}
        {formatBytes(session.receivedBytes)} of {formatBytes(session.declaredBytes)}
      </span>
    </div>
  );
}

function JobCard({
  job,
  primary,
}: {
  readonly job: ProUploadJob;
  /** Only the most urgent job gets the amber button (one accent element in view). */
  readonly primary: boolean;
}) {
  const status = STATUS_LABEL[job.bookingStatus] ?? {
    label: formatCode(job.bookingStatus),
    tone: 'idle',
  };
  const awaiting = AWAITING.has(job.bookingStatus);
  return (
    <article className="card lift job">
      <div className="job-head">
        <div>
          <span className="ref">{job.bookingReference}</span>
          <div className="meta">
            <span>
              <Icon name="camera" size="sm" />
              {formatCode(job.categoryCode)} · {formatCode(job.tier)}
            </span>
            <span>
              <Icon name="calendar" size="sm" />
              Shot {formatDateTime(job.scheduledStart)}
            </span>
          </div>
        </div>
        <StatusPill tone={status.tone} label={status.label} live={status.live} />
      </div>
      {awaiting ? (
        <div className="job-foot">
          <div>
            <span className="micro faint">Upload deadline</span>
            <Deadline job={job} />
            <SessionProgress job={job} />
          </div>
          <a
            className={primary ? 'button' : 'button secondary'}
            href={`/jobs/${job.bookingId}/upload`}
          >
            {job.activeSession ? 'Resume upload' : 'Upload photos'}
            <Icon name="forward" size="sm" />
          </a>
        </div>
      ) : (
        <div className="job-foot">
          <div>
            <div className="row">
              <span className="chip">
                <strong>{job.media.rawFiles}</strong> RAW
              </span>
              <span className="chip">
                <strong>{job.media.jpegFiles}</strong> JPEG
              </span>
              <span className="chip">
                <strong>{formatBytes(job.media.uploadedBytes)}</strong> uploaded
              </span>
            </div>
          </div>
          <a className="button secondary" href={`/jobs/${job.bookingId}/status`}>
            View status
          </a>
        </div>
      )}
    </article>
  );
}

function SkeletonCard() {
  return (
    <div className="card job" aria-hidden="true">
      <div className="skeleton sk-title" />
      <div className="skeleton sk-line" />
      <div className="skeleton sk-short" />
    </div>
  );
}

function Empty({ onRetry }: { readonly onRetry: () => void }) {
  return (
    <div className="card white empty reveal">
      <div className="empty-art">
        <span className="art-dots dots fade-mask" aria-hidden="true" />
        <span className="tile lg round">
          <Icon name="camera" size="lg" />
        </span>
      </div>
      <h2>No shoots are waiting for an upload</h2>
      <p className="lede">A job appears here as soon as you check out of a shoot in the Pro app.</p>
      <button type="button" className="secondary" onClick={onRetry}>
        <Icon name="refresh" size="sm" />
        Check again
      </button>
    </div>
  );
}

function Group({
  title,
  jobs,
  primaryId,
  children,
}: {
  readonly title: string;
  readonly jobs: readonly ProUploadJob[];
  readonly primaryId: string | null;
  readonly children?: ReactNode;
}) {
  if (jobs.length === 0) return null;
  return (
    <section className="group" aria-label={title}>
      <h2 className="group-label">
        {title} <span className="count num">{jobs.length}</span>
      </h2>
      {children}
      <div className="group reveal-list">
        {jobs.map((job) => (
          <JobCard key={job.bookingId} job={job} primary={job.bookingId === primaryId} />
        ))}
      </div>
    </section>
  );
}

/** Jobs awaiting upload, with a live countdown to check-out + 6 h (doc 02 §7). */
export function JobList() {
  // "Try again" / "Check again" remount the list, which starts a fresh load.
  const [attempt, setAttempt] = useState(0);
  return <Jobs key={attempt} onRetry={() => setAttempt((n) => n + 1)} />;
}

/**
 * Polls every 30 s while the tab is visible, backing off while the API fails. A failed refresh
 * keeps the list on screen with a notice; the countdowns tick inside DeadlineCountdown alone.
 */
function Jobs({ onRetry }: { readonly onRetry: () => void }) {
  const { data: jobs, error } = usePoll(listUploadJobs, { everyMs: POLL_MS });

  if (error && jobs === undefined) {
    return (
      <div className="stack loose">
        <Callout tone="bad" title="Could not load your shoots" alert>
          {errorMessage(error)}
        </Callout>
        <div>
          <button type="button" className="secondary" onClick={onRetry}>
            <Icon name="refresh" size="sm" />
            Try again
          </button>
        </div>
      </div>
    );
  }
  if (jobs === undefined) {
    return (
      <div className="group" role="status">
        <span className="visually-hidden">Loading your shoots…</span>
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }
  if (jobs.length === 0) return <Empty onRetry={onRetry} />;

  const awaiting = jobs.filter((j) => AWAITING.has(j.bookingStatus));
  const uploaded = jobs.filter((j) => !AWAITING.has(j.bookingStatus));
  const primaryId = awaiting[0]?.bookingId ?? null;
  return (
    <div className="groups">
      {error ? (
        <Callout tone="bad" title="Could not refresh your shoots" alert>
          {errorMessage(error)} Showing the last list; retrying automatically.
        </Callout>
      ) : null}
      <Group title="To upload" jobs={awaiting} primaryId={primaryId}>
        <Callout tone="accent" title={`${MEDIA_LIMITS.uploadDeadlineHours}-hour upload window`}>
          The clock starts when you check out. A late upload counts against your on-time rate (it
          affects the offers you get) and Clickco ops will call you.
        </Callout>
      </Group>
      <Group title="Uploaded" jobs={uploaded} primaryId={null} />
    </div>
  );
}
