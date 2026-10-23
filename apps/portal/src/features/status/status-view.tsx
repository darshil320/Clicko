'use client';

import type { ProUploadJob } from '@clickco/contracts';
import { useEffect, useState } from 'react';
import { errorMessage } from '../../shared/api';
import { formatBytes } from '../../shared/format';
import { useRequireSession } from '../../shared/hooks';
import { findUploadJob } from '../../shared/jobs-api';

const STEPS = [
  {
    status: 'UPLOADING',
    label: 'Upload verified',
    detail: 'Every file arrived intact (checksums matched)',
  },
  {
    status: 'PROCESSING',
    label: 'Processing',
    detail: 'RAW files are converted to full-resolution JPEGs',
  },
  {
    status: 'QA',
    label: 'Quality check',
    detail: 'Clickco checks file counts and obvious corruption',
  },
] as const;

const ORDER = ['CHECKED_OUT', 'UPLOADING', 'PROCESSING', 'QA'];

/** Processing + verification status after an upload (doc 02 §7 status page). */
export function StatusView({ bookingId }: { readonly bookingId: string }) {
  const session = useRequireSession();
  const [job, setJob] = useState<ProUploadJob | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    let live = true;
    const load = () =>
      findUploadJob(bookingId)
        .then((j) => live && setJob(j))
        .catch((e: unknown) => live && setError(errorMessage(e)));
    void load();
    const id = setInterval(load, 10_000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [bookingId, session]);

  if (error) return <p className="err">{error}</p>;
  if (job === undefined) return <p className="muted">Loading…</p>;
  if (job === null) {
    return (
      <div className="card stack">
        <span>This shoot is no longer in your upload list — it has moved on to delivery.</span>
        <a className="button secondary" href="/jobs">
          Back to jobs
        </a>
      </div>
    );
  }
  const reached = ORDER.indexOf(job.bookingStatus);
  // The upload itself is only "verified" once the booking has left UPLOADING.
  const doneThrough =
    job.bookingStatus === 'UPLOADING' || job.bookingStatus === 'CHECKED_OUT' ? 0 : reached;
  return (
    <div className="stack">
      <h1>Status · {job.bookingReference}</h1>
      <div className="card stack" data-testid="status">
        {STEPS.map((step) => {
          const index = ORDER.indexOf(step.status);
          const state = index < doneThrough ? 'done' : index === doneThrough ? 'current' : 'later';
          const pill = state === 'done' ? 'ok' : state === 'current' ? 'warn' : 'idle';
          const text = state === 'done' ? 'Done' : state === 'current' ? 'In progress' : 'Waiting';
          return (
            <div className="spread" key={step.status}>
              <div>
                <strong>{step.label}</strong>
                <div className="muted small">{step.detail}</div>
              </div>
              <span className={`pill ${pill}`}>{text}</span>
            </div>
          );
        })}
      </div>
      <div className="card stats">
        <div className="stat">
          <div className="muted small">RAW files</div>
          <div className="value">{job.media.rawFiles}</div>
        </div>
        <div className="stat">
          <div className="muted small">JPEG files</div>
          <div className="value">{job.media.jpegFiles}</div>
        </div>
        <div className="stat">
          <div className="muted small">JPEGs exported</div>
          <div className="value">{job.media.exportedJpegs}</div>
        </div>
        <div className="stat">
          <div className="muted small">Uploaded</div>
          <div className="value">{formatBytes(job.media.uploadedBytes)}</div>
        </div>
      </div>
      <p className="muted small">
        You are paid for this shoot once it is delivered. The client receives the files from Clickco
        — never share them yourself.
      </p>
      {job.bookingStatus === 'CHECKED_OUT' || job.bookingStatus === 'UPLOADING' ? (
        <a className="button" href={`/jobs/${bookingId}/upload`}>
          Go to upload
        </a>
      ) : null}
    </div>
  );
}
