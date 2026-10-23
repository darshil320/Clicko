'use client';

import { JPEG_EXTENSIONS, MEDIA_LIMITS, RAW_EXTENSIONS } from '@clickco/contracts';
import { type DragEvent, useEffect, useState } from 'react';
import { formatBytes, formatCountdown, formatDuration } from '../../shared/format';
import { useNow, useRequireSession } from '../../shared/hooks';
import { summariseRejections } from './file-filter';
import { filesFromDrop, filesFromInput } from './folder-drop';
import type { UploadProgress } from './uploader';
import { type UploadStage, useUpload } from './use-upload';

const ACCEPT = [...RAW_EXTENSIONS, ...JPEG_EXTENSIONS].join(',');
/** React has no type for the non-standard folder-picker attribute. */
const FOLDER_PICKER = { webkitdirectory: '', directory: '' } as Record<string, string>;

function Rejections({
  rejected,
}: {
  readonly rejected: Parameters<typeof summariseRejections>[0];
}) {
  if (rejected.length === 0) return null;
  return (
    <div className="card">
      <strong>{rejected.length} file(s) skipped</strong>
      <ul className="plain small">
        {summariseRejections(rejected).map((g) => (
          <li key={g.reason}>
            <span className="err">{g.message}</span>
            <span className="muted">
              {' '}
              — {g.names.slice(0, 5).join(', ')}
              {g.names.length > 5 ? ` and ${g.names.length - 5} more` : ''}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DropZone({
  onFiles,
  label,
}: {
  readonly onFiles: (f: Awaited<ReturnType<typeof filesFromDrop>>) => void;
  readonly label: string;
}) {
  const [active, setActive] = useState(false);
  const [reading, setReading] = useState(false);
  const onDrop = async (e: DragEvent) => {
    e.preventDefault();
    setActive(false);
    setReading(true);
    try {
      onFiles(await filesFromDrop(e.dataTransfer));
    } finally {
      setReading(false);
    }
  };
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a drag-and-drop target; keyboard users use the file and folder buttons inside it
    <div
      className={active ? 'drop active stack' : 'drop stack'}
      onDragOver={(e) => {
        e.preventDefault();
        setActive(true);
      }}
      onDragLeave={() => setActive(false)}
      onDrop={onDrop}
      data-testid="drop-zone"
    >
      <strong>{reading ? 'Reading the folder…' : label}</strong>
      <span className="small">
        RAW (.cr2 .cr3 .nef .arw .raf .orf .rw2 .dng) and JPEG. Everything else is skipped.
      </span>
      <div className="row center">
        <label className="button secondary">
          Choose files
          <input
            type="file"
            multiple
            accept={ACCEPT}
            hidden
            data-testid="file-input"
            onChange={(e) => onFiles(filesFromInput(e.target.files))}
          />
        </label>
        <label className="button secondary">
          Choose card folder
          <input
            type="file"
            multiple
            hidden
            {...FOLDER_PICKER}
            onChange={(e) => onFiles(filesFromInput(e.target.files))}
          />
        </label>
      </div>
    </div>
  );
}

function ProgressView({ progress }: { readonly progress: UploadProgress }) {
  const share = progress.bytesAll === 0 ? 0 : (progress.bytesDone / progress.bytesAll) * 100;
  return (
    <div className="card stack" data-testid="progress">
      <div
        className="bar"
        role="progressbar"
        aria-valuenow={Math.floor(share)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <span style={{ width: `${share}%` }} />
      </div>
      <div className="stats">
        <div className="stat">
          <div className="muted small">Uploaded (confirmed)</div>
          <div className="value">{formatBytes(progress.bytesDone)}</div>
          <div className="muted small">of {formatBytes(progress.bytesAll)}</div>
        </div>
        <div className="stat">
          <div className="muted small">Files verified</div>
          <div className="value">
            {progress.filesDone} / {progress.filesAll}
          </div>
        </div>
        <div className="stat">
          <div className="muted small">Speed</div>
          <div className="value">
            {progress.bytesPerSecond === null ? '—' : `${formatBytes(progress.bytesPerSecond)}/s`}
          </div>
        </div>
        <div className="stat">
          <div className="muted small">Time left</div>
          <div className="value">
            {progress.etaSeconds === null ? 'measuring…' : formatDuration(progress.etaSeconds)}
          </div>
        </div>
      </div>
      {progress.activeFiles.length > 0 ? (
        <span className="muted small">Sending: {progress.activeFiles.slice(0, 4).join(', ')}</span>
      ) : null}
      {progress.retrying ? (
        <span className="small warn-text">
          Connection trouble — retry {progress.retrying.attempt} of{' '}
          {MEDIA_LIMITS.backoffScheduleMs.length} in {progress.retrying.delayMs / 1000} s (
          {progress.retrying.message})
        </span>
      ) : null}
      {progress.error ? (
        <p className="err" role="alert">
          {progress.error.message}
        </p>
      ) : null}
    </div>
  );
}

function SelectStage({
  stage,
  onFiles,
  onStart,
  onClear,
}: {
  readonly stage: Extract<UploadStage, { kind: 'select' }>;
  readonly onFiles: (f: Awaited<ReturnType<typeof filesFromDrop>>) => void;
  readonly onStart: (frames: number) => void;
  readonly onClear: () => void;
}) {
  const [frames, setFrames] = useState<number | null>(null);
  const bytes = stage.accepted.reduce((sum, a) => sum + a.file.size, 0);
  const raw = stage.accepted.filter((a) => a.kind === 'RAW_PHOTO').length;
  const declared = frames ?? stage.detectedFrames;
  return (
    <div className="stack">
      <DropZone onFiles={onFiles} label="Drag the card folder here" />
      <Rejections rejected={stage.rejected} />
      {stage.accepted.length > 0 ? (
        <div className="card stack">
          <div className="spread">
            <strong data-testid="selection-summary">
              {stage.accepted.length} files · {raw} RAW · {stage.accepted.length - raw} JPEG ·{' '}
              {formatBytes(bytes)}
            </strong>
            <button type="button" className="link" onClick={onClear}>
              Clear selection
            </button>
          </div>
          <label>
            Frames shot (a RAW + JPEG pair is one frame) — we found {stage.detectedFrames}
            <input
              name="frames"
              inputMode="numeric"
              value={String(declared)}
              onChange={(e) =>
                setFrames(Number.parseInt(e.target.value.replace(/\D/g, '') || '0', 10))
              }
            />
          </label>
          {declared !== stage.detectedFrames ? (
            <span className="err small">
              The selected files contain {stage.detectedFrames} frames. Add the missing files, or
              correct the count.
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => onStart(declared)}
            disabled={declared !== stage.detectedFrames}
          >
            Start upload
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** The uploader screen (doc 02 §7): drop, review, upload with honest progress, resume. */
export function UploadPanel({ bookingId }: { readonly bookingId: string }) {
  const session = useRequireSession();
  const now = useNow(1_000);
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

  const deadline = job?.uploadDeadlineAt
    ? formatCountdown(Date.parse(job.uploadDeadlineAt), now)
    : null;
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
    <div className="stack">
      <div className="spread">
        <div>
          <h1>Upload {job?.bookingReference ?? ''}</h1>
          {job ? (
            <span className="muted">
              {job.categoryCode} · {job.tier}
            </span>
          ) : null}
        </div>
        {deadline ? (
          <div className="stack align-end">
            <span
              className={deadline.overdue ? 'overdue countdown' : 'countdown'}
              data-testid="deadline"
            >
              {deadline.text}
            </span>
            <span className="muted small">
              Upload deadline: {MEDIA_LIMITS.uploadDeadlineHours} h after check-out
            </span>
          </div>
        ) : null}
      </div>
      {upload.error ? (
        <p className="err" role="alert">
          {upload.error}
        </p>
      ) : null}

      {stage.kind === 'loading' ? <p className="muted">Loading…</p> : null}
      {stage.kind === 'blocked' ? (
        <div className="card stack">
          <span>{stage.message}</span>
          <div className="row">
            {stage.showStatus ? (
              <a className="button" href={`/jobs/${bookingId}/status`}>
                View status
              </a>
            ) : null}
            <a className="button secondary" href="/jobs">
              Back to jobs
            </a>
          </div>
        </div>
      ) : null}
      {stage.kind === 'select' ? (
        <SelectStage
          stage={stage}
          onFiles={upload.addFiles}
          onStart={(n) => void upload.start(n)}
          onClear={upload.clearSelection}
        />
      ) : null}
      {stage.kind === 'resume' ? (
        <div className="stack">
          <div className="card stack">
            <strong>An upload for this shoot is unfinished</strong>
            <span className="muted">
              {stage.session.receivedFileCount} of {stage.session.declaredFileCount} files are
              already verified. Drop the same card folder to resume — finished parts are not sent
              again.
            </span>
            {stage.missing.length > 0 ? (
              <span className="err small">
                Still missing from what you dropped:{' '}
                {stage.missing
                  .slice(0, 5)
                  .map((f) => f.name)
                  .join(', ')}
                {stage.missing.length > 5 ? ` and ${stage.missing.length - 5} more` : ''}. Files
                must be the same (name, size and date) as when the upload started.
              </span>
            ) : null}
            <div className="row">
              <button type="button" className="danger" onClick={confirmCancel}>
                Cancel this upload and start again
              </button>
            </div>
          </div>
          <DropZone onFiles={upload.addFiles} label="Drop the same card folder to resume" />
          <Rejections rejected={stage.rejected} />
        </div>
      ) : null}
      {stage.kind === 'running' || stage.kind === 'paused' || stage.kind === 'failed' ? (
        <div className="stack">
          <ProgressView progress={stage.progress} />
          <div className="row">
            {stage.kind === 'running' ? (
              <button
                type="button"
                className="secondary"
                onClick={upload.pause}
                disabled={stage.progress.phase === 'finishing'}
              >
                Pause
              </button>
            ) : (
              <button type="button" onClick={() => void upload.resume()}>
                Resume
              </button>
            )}
            <button type="button" className="danger" onClick={confirmCancel}>
              Cancel upload
            </button>
          </div>
          {stage.kind === 'running' ? (
            <span className="muted small">
              Keep this tab open. If it closes, sign in again and drop the same folder — the upload
              resumes where it stopped.
            </span>
          ) : null}
        </div>
      ) : null}
      {stage.kind === 'done' ? (
        <div className="card stack" data-testid="upload-done">
          <strong>Upload complete — {stage.result.receivedFileCount} files verified</strong>
          <span className="muted">
            {formatBytes(stage.result.receivedBytes)} received and checked. Clickco now converts the
            RAW files and runs QA.
          </span>
          <a className="button" href={`/jobs/${bookingId}/status`}>
            View status
          </a>
        </div>
      ) : null}
    </div>
  );
}
