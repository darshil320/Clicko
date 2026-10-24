'use client';

import { MEDIA_LIMITS } from '@clickco/contracts';
import { formatBytes, formatDuration } from '../../shared/format';
import { Icon } from '../../shared/icons';
import { Callout } from '../../shared/ui';
import type { UploadProgress } from './uploader';

type RunKind = 'running' | 'paused' | 'failed';

function stateLabel(kind: RunKind, progress: UploadProgress): string {
  if (kind === 'paused') return 'Paused';
  if (kind === 'failed') return 'Upload stopped';
  return progress.phase === 'finishing' ? 'Finishing — checking every file' : 'Uploading';
}

/** Files on the wire right now. The uploader reports names, not per-file bytes: no fake numbers. */
function Sending({ names }: { readonly names: readonly string[] }) {
  if (names.length === 0) return null;
  return (
    <div className="stack">
      <span className="micro faint">Now sending</span>
      <ul className="files">
        {names.slice(0, 4).map((name) => (
          <li key={name}>
            <Icon name="image" size="sm" />
            <span className="file-main truncate">{name}</span>
            <span className="bar thin indeterminate file-bar" aria-hidden="true">
              <span />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Honest progress (doc 02 §7): confirmed bytes, verified files, measured speed and ETA. */
export function ProgressView({
  progress,
  kind,
}: {
  readonly progress: UploadProgress;
  readonly kind: RunKind;
}) {
  const share = progress.bytesAll === 0 ? 0 : (progress.bytesDone / progress.bytesAll) * 100;
  const percent = Math.floor(share);
  const stats = [
    ['Uploaded', formatBytes(progress.bytesDone), `of ${formatBytes(progress.bytesAll)}`],
    ['Files verified', `${progress.filesDone} / ${progress.filesAll}`, 'checksums matched'],
    [
      'Speed',
      progress.bytesPerSecond === null ? '—' : `${formatBytes(progress.bytesPerSecond)}/s`,
      'last 30 seconds',
    ],
    [
      'Time left',
      progress.etaSeconds === null ? 'measuring…' : formatDuration(progress.etaSeconds),
      'at this speed',
    ],
  ] as const;
  return (
    <section className="card white stack loose" data-testid="progress" aria-label="Upload progress">
      <div className="progress-head">
        <div className="stack tight">
          <span className={`state ${kind}`}>
            <span className={kind === 'running' ? 'dot live' : 'dot'} aria-hidden="true" />
            {stateLabel(kind, progress)}
          </span>
          <span className="small muted num">Only bytes Clickco has confirmed are counted</span>
        </div>
        <span className="percent" aria-hidden="true">
          {percent}%
        </span>
      </div>
      <div
        className={kind === 'running' ? 'bar running' : 'bar paused'}
        role="progressbar"
        aria-label="Upload progress"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={`${percent}% — ${formatBytes(progress.bytesDone)} of ${formatBytes(progress.bytesAll)}`}
      >
        <span style={{ width: `${share}%` }} />
      </div>
      <div className="stats">
        {stats.map(([label, value, sub]) => (
          <div className="stat" key={label}>
            <span className="stat-label">{label}</span>
            <span className="stat-value">{value}</span>
            <span className="stat-sub">{sub}</span>
          </div>
        ))}
      </div>
      {kind === 'running' ? <Sending names={progress.activeFiles} /> : null}
      {progress.retrying ? (
        <Callout tone="warn" title="Connection trouble">
          Retry {progress.retrying.attempt} of {MEDIA_LIMITS.backoffScheduleMs.length} in{' '}
          {progress.retrying.delayMs / 1000} s ({progress.retrying.message})
        </Callout>
      ) : null}
      {progress.error ? (
        <Callout tone="bad" title="The upload stopped" alert>
          {progress.error.message}
        </Callout>
      ) : null}
    </section>
  );
}
