'use client';

import type { ProUploadJob } from '@clickco/contracts';
import { useCallback } from 'react';
import { errorMessage } from '../../shared/api';
import { formatBytes, formatCode, formatDateTime } from '../../shared/format';
import { useRequireSession } from '../../shared/hooks';
import { Icon, type IconName } from '../../shared/icons';
import { findUploadJob } from '../../shared/jobs-api';
import { BackLink, Callout, Loading, StatusPill } from '../../shared/ui';
import { usePoll } from '../../shared/use-poll';

const POLL_MS = 10_000;

const STEPS = [
  {
    status: 'UPLOADING',
    label: 'Upload verified',
    detail: 'Every file arrived intact (checksums matched)',
    icon: 'shield',
  },
  {
    status: 'PROCESSING',
    label: 'Processing',
    detail: 'RAW files are converted to full-resolution JPEGs',
    icon: 'image',
  },
  {
    status: 'QA',
    label: 'Quality check',
    detail: 'Clickco checks file counts and obvious corruption',
    icon: 'eye',
  },
] as const satisfies ReadonlyArray<{
  status: string;
  label: string;
  detail: string;
  icon: IconName;
}>;

const ORDER = ['CHECKED_OUT', 'UPLOADING', 'PROCESSING', 'QA'];

/** Statuses this page still watches; anything else (or leaving the list) is final. */
const WATCHED: ReadonlySet<string> = new Set(ORDER);

/** Delivered, cancelled or gone from the upload list: nothing left to poll for. */
const isFinalJob = (job: ProUploadJob | null): boolean =>
  job === null || !WATCHED.has(job.bookingStatus);

type StepState = 'done' | 'current' | 'later';

const STATE_PILL = {
  done: { tone: 'ok', text: 'Done' },
  current: { tone: 'warn', text: 'In progress' },
  later: { tone: 'idle', text: 'Waiting' },
} as const;

function Timeline({ job }: { readonly job: ProUploadJob }) {
  const reached = ORDER.indexOf(job.bookingStatus);
  // The upload itself is only "verified" once the booking has left UPLOADING.
  const doneThrough =
    job.bookingStatus === 'UPLOADING' || job.bookingStatus === 'CHECKED_OUT' ? 0 : reached;
  return (
    <ol className="timeline reveal-list" data-testid="status">
      {STEPS.map((step) => {
        const index = ORDER.indexOf(step.status);
        const state: StepState =
          index < doneThrough ? 'done' : index === doneThrough ? 'current' : 'later';
        const pill = STATE_PILL[state];
        return (
          <li className={`step ${state}`} key={step.status}>
            <span className="node" aria-hidden="true">
              {state === 'done' ? (
                <Icon name="check" size="sm" />
              ) : state === 'current' ? (
                <span className="dot live" />
              ) : (
                <Icon name={step.icon} size="sm" />
              )}
            </span>
            <div className="step-body">
              <span className="step-title">{step.label}</span>
              <span className="muted small">{step.detail}</span>
            </div>
            <StatusPill tone={pill.tone} label={pill.text} />
          </li>
        );
      })}
    </ol>
  );
}

function Stats({ job }: { readonly job: ProUploadJob }) {
  const stats = [
    ['RAW files', String(job.media.rawFiles)],
    ['JPEG files', String(job.media.jpegFiles)],
    ['JPEGs exported', String(job.media.exportedJpegs)],
    ['Uploaded', formatBytes(job.media.uploadedBytes)],
  ] as const;
  return (
    <div className="stats reveal-list">
      {stats.map(([label, value]) => (
        <div className="stat" key={label}>
          <span className="stat-label">{label}</span>
          <span className="stat-value">{value}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * Processing + verification status after an upload (doc 02 §7 status page). Polls every 10 s
 * while the tab is visible, stops once the shoot reaches a final status, backs off on errors.
 */
export function StatusView({ bookingId }: { readonly bookingId: string }) {
  const session = useRequireSession();
  const load = useCallback(() => findUploadJob(bookingId), [bookingId]);
  const { data: job, error } = usePoll(load, {
    everyMs: POLL_MS,
    enabled: session !== null,
    isFinal: isFinalJob,
  });

  if (error && job === undefined) {
    return (
      <div className="page">
        <BackLink href="/jobs">Your shoots</BackLink>
        <Callout tone="bad" title="Could not load this shoot" alert>
          {errorMessage(error)}
        </Callout>
      </div>
    );
  }
  if (job === undefined) return <Loading />;
  if (job === null) {
    return (
      <div className="page">
        <BackLink href="/jobs">Your shoots</BackLink>
        <div className="card white empty reveal">
          <span className="tile lg round ok">
            <Icon name="check" size="lg" />
          </span>
          <h2>This shoot has moved on to delivery</h2>
          <p className="lede">It is no longer in your upload list.</p>
          <a className="button secondary" href="/jobs">
            Back to your shoots
          </a>
        </div>
      </div>
    );
  }
  const canUpload = job.bookingStatus === 'CHECKED_OUT' || job.bookingStatus === 'UPLOADING';
  return (
    <div className="page">
      <BackLink href="/jobs">Your shoots</BackLink>
      <header className="page-head reveal">
        <div>
          <span className="eyebrow">Status</span>
          <h1 className="num">{job.bookingReference}</h1>
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
        {canUpload ? (
          <a className="button" href={`/jobs/${bookingId}/upload`}>
            Go to upload
            <Icon name="forward" size="sm" />
          </a>
        ) : null}
      </header>
      {error ? (
        <Callout tone="bad" title="Could not refresh this shoot" alert>
          {errorMessage(error)} Showing the last status; retrying automatically.
        </Callout>
      ) : null}
      <section className="card white">
        <Timeline job={job} />
      </section>
      <Stats job={job} />
      <Callout tone="info" icon="shield">
        You are paid for this shoot once it is delivered. The client receives the files from Clickco
        — never share them yourself.
      </Callout>
    </div>
  );
}
