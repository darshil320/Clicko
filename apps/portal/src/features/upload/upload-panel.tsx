'use client';

import { MEDIA_LIMITS, type ProUploadJob } from '@clickco/contracts';
import { useEffect } from 'react';
import { DeadlineCountdown } from '../../shared/countdown';
import { formatBytes, formatCode, formatDateTime } from '../../shared/format';
import { useRequireSession } from '../../shared/hooks';
import { Icon } from '../../shared/icons';
import { BackLink, Callout, Loading } from '../../shared/ui';
import { DropZone, Rejections } from './drop-zone';
import { ProgressView } from './progress-view';
import { SelectStage } from './selection';
import { type UploadStage, useUpload } from './use-upload';

type Upload = ReturnType<typeof useUpload>;

function Head({ job }: { readonly job: ProUploadJob | null }) {
  return (
    <header className="page-head reveal">
      <div>
        <span className="eyebrow">Upload</span>
        <h1 className="num">{job?.bookingReference ?? 'Upload photos'}</h1>
        {job ? (
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
        ) : null}
      </div>
      {job?.uploadDeadlineAt ? (
        <div className="deadline-box">
          <span className="micro faint">Upload deadline</span>
          <DeadlineCountdown deadlineAt={job.uploadDeadlineAt} testId="deadline" />
          <span className="muted small">
            Due {formatDateTime(job.uploadDeadlineAt)} · {MEDIA_LIMITS.uploadDeadlineHours} h after
            check-out
          </span>
        </div>
      ) : null}
    </header>
  );
}

function Blocked({
  stage,
  bookingId,
}: {
  readonly stage: Extract<UploadStage, { kind: 'blocked' }>;
  readonly bookingId: string;
}) {
  return (
    <div className="card white empty reveal">
      <span className={stage.showStatus ? 'tile lg round ok' : 'tile lg round'}>
        <Icon name={stage.showStatus ? 'check' : 'info'} size="lg" />
      </span>
      <h2>{stage.message}</h2>
      <div className="row center">
        {stage.showStatus ? (
          <a className="button" href={`/jobs/${bookingId}/status`}>
            View status
          </a>
        ) : null}
        <a className="button secondary" href="/jobs">
          Back to your shoots
        </a>
      </div>
    </div>
  );
}

function Resume({
  stage,
  upload,
  onCancel,
}: {
  readonly stage: Extract<UploadStage, { kind: 'resume' }>;
  readonly upload: Upload;
  readonly onCancel: () => void;
}) {
  const { session, missing } = stage;
  const share =
    session.declaredBytes === 0 ? 0 : (session.receivedBytes / session.declaredBytes) * 100;
  return (
    <div className="stack loose">
      <section className="card white stack loose reveal">
        <div className="lead-row">
          <span className="tile warn">
            <Icon name="refresh" />
          </span>
          <div className="stack tight">
            <h2>An upload for this shoot is unfinished</h2>
            <p className="muted">
              {session.receivedFileCount} of {session.declaredFileCount} files are already verified.
              Drop the same card folder to resume — finished parts are not sent again.
            </p>
          </div>
        </div>
        <div
          className="bar neutral"
          role="progressbar"
          aria-label="Already uploaded"
          aria-valuenow={Math.floor(share)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <span style={{ width: `${share}%` }} />
        </div>
        {missing.length > 0 ? (
          <Callout tone="bad" title="Some files are still missing">
            Still missing from what you dropped:{' '}
            {missing
              .slice(0, 5)
              .map((f) => f.name)
              .join(', ')}
            {missing.length > 5 ? ` and ${missing.length - 5} more` : ''}. Files must be the same
            (name, size and date) as when the upload started.
          </Callout>
        ) : null}
      </section>
      <DropZone onFiles={upload.addFiles} title="Drop the same card folder to resume" />
      <Rejections rejected={stage.rejected} />
      <div className="row">
        <button type="button" className="danger" onClick={onCancel}>
          <Icon name="x" size="sm" />
          Cancel this upload and start again
        </button>
      </div>
    </div>
  );
}

const RUN_NOTE = {
  running:
    'Keep this tab open. If it closes, sign in again and drop the same folder — the upload resumes where it stopped.',
  paused: 'Paused. Parts already confirmed are kept — resume when you are ready.',
  failed: 'Resume to try again from where it stopped.',
} as const;

function Running({
  stage,
  upload,
  onCancel,
}: {
  readonly stage: Extract<UploadStage, { kind: 'running' | 'paused' | 'failed' }>;
  readonly upload: Upload;
  readonly onCancel: () => void;
}) {
  return (
    <div className="stack loose">
      <ProgressView progress={stage.progress} kind={stage.kind} />
      <div className="spread">
        <span className="small muted">{RUN_NOTE[stage.kind]}</span>
        <div className="row">
          {stage.kind === 'running' ? (
            <button
              type="button"
              className="secondary"
              onClick={upload.pause}
              disabled={stage.progress.phase === 'finishing'}
            >
              <Icon name="pause" size="sm" />
              Pause
            </button>
          ) : (
            <button type="button" onClick={() => void upload.resume()}>
              <Icon name="play" size="sm" />
              Resume
            </button>
          )}
          <button type="button" className="danger" onClick={onCancel}>
            <Icon name="x" size="sm" />
            Cancel upload
          </button>
        </div>
      </div>
    </div>
  );
}

function Done({
  stage,
  bookingId,
}: {
  readonly stage: Extract<UploadStage, { kind: 'done' }>;
  readonly bookingId: string;
}) {
  return (
    <section className="card white done-card reveal" data-testid="upload-done">
      <span className="tile lg round ok">
        <Icon name="check" size="lg" />
      </span>
      <h2>Upload complete — {stage.result.receivedFileCount} files verified</h2>
      <p className="lede">
        {formatBytes(stage.result.receivedBytes)} received and checked. Clickco now converts the RAW
        files and runs QA.
      </p>
      <a className="button" href={`/jobs/${bookingId}/status`}>
        View status
        <Icon name="forward" size="sm" />
      </a>
    </section>
  );
}

/** The uploader screen (doc 02 §7): drop, review, upload with honest progress, resume. */
export function UploadPanel({ bookingId }: { readonly bookingId: string }) {
  const session = useRequireSession();
  const upload = useUpload(bookingId, session?.photographer.id ?? null);
  const { stage, job } = upload;

  useEffect(() => {
    if (stage.kind !== 'running') return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [stage.kind]);

  const confirmCancel = () => {
    if (
      window.confirm(
        'Cancel this upload? Files already uploaded in it are deleted and you start again.',
      )
    ) {
      void upload.cancel();
    }
  };

  return (
    <div className="page">
      <BackLink href="/jobs">Your shoots</BackLink>
      <Head job={job} />
      {upload.error ? (
        <Callout tone="bad" alert>
          {upload.error}
        </Callout>
      ) : null}
      {stage.kind === 'loading' ? <Loading /> : null}
      {stage.kind === 'blocked' ? <Blocked stage={stage} bookingId={bookingId} /> : null}
      {stage.kind === 'select' ? (
        <SelectStage
          stage={stage}
          onFiles={upload.addFiles}
          onStart={(n) => void upload.start(n)}
          onClear={upload.clearSelection}
        />
      ) : null}
      {stage.kind === 'resume' ? (
        <Resume stage={stage} upload={upload} onCancel={confirmCancel} />
      ) : null}
      {stage.kind === 'running' || stage.kind === 'paused' || stage.kind === 'failed' ? (
        <Running stage={stage} upload={upload} onCancel={confirmCancel} />
      ) : null}
      {stage.kind === 'done' ? <Done stage={stage} bookingId={bookingId} /> : null}
    </div>
  );
}
