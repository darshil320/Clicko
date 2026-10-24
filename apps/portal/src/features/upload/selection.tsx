'use client';

import { useState } from 'react';
import { formatBytes } from '../../shared/format';
import { Icon } from '../../shared/icons';
import { Callout } from '../../shared/ui';
import { DropZone, Rejections } from './drop-zone';
import type { AcceptedFile } from './file-filter';
import type { SourceFile } from './uploader';
import type { UploadStage } from './use-upload';

/** A preview, not a ledger: the summary line carries the totals. */
const PREVIEW = 8;

const folderOf = (path: string | undefined): string | null => {
  const cut = path?.lastIndexOf('/') ?? -1;
  return path && cut > 0 ? path.slice(0, cut) : null;
};

function FileList({ files }: { readonly files: ReadonlyArray<AcceptedFile<SourceFile>> }) {
  return (
    <ul className="files reveal-list" aria-label="Selected files">
      {files.slice(0, PREVIEW).map(({ file, kind }) => {
        const folder = folderOf(file.path);
        return (
          <li key={file.path ?? file.name}>
            <span className={kind === 'RAW_PHOTO' ? 'kind raw' : 'kind'}>
              {kind === 'RAW_PHOTO' ? 'RAW' : kind === 'JPEG_PHOTO' ? 'JPEG' : 'Video'}
            </span>
            <span className="file-main">
              <span className="truncate">{file.name}</span>
              {folder ? <span className="file-sub truncate">{folder}</span> : null}
            </span>
            <span className="file-size">{formatBytes(file.size)}</span>
          </li>
        );
      })}
      {files.length > PREVIEW ? (
        <li className="more num">and {files.length - PREVIEW} more files</li>
      ) : null}
    </ul>
  );
}

/** Drop, review what was found, confirm the frame count, start (doc 02 §7). */
export function SelectStage({
  stage,
  onFiles,
  onStart,
  onClear,
}: {
  readonly stage: Extract<UploadStage, { kind: 'select' }>;
  readonly onFiles: (f: SourceFile[]) => void;
  readonly onStart: (frames: number) => void;
  readonly onClear: () => void;
}) {
  const [frames, setFrames] = useState<number | null>(null);
  const bytes = stage.accepted.reduce((sum, a) => sum + a.file.size, 0);
  const raw = stage.accepted.filter((a) => a.kind === 'RAW_PHOTO').length;
  const declared = frames ?? stage.detectedFrames;
  const mismatch = declared !== stage.detectedFrames;
  return (
    <div className="stack loose">
      <DropZone onFiles={onFiles} title="Drag the card folder here" />
      <Rejections rejected={stage.rejected} />
      {stage.accepted.length > 0 ? (
        <section className="card white stack loose reveal" aria-label="Ready to upload">
          <div className="spread">
            <div className="stack tight">
              <h2>Ready to upload</h2>
              <span className="muted num" data-testid="selection-summary">
                {stage.accepted.length} files · {raw} RAW · {stage.accepted.length - raw} JPEG ·{' '}
                {formatBytes(bytes)}
              </span>
            </div>
            <button type="button" className="ghost sm" onClick={onClear}>
              <Icon name="x" size="sm" />
              Clear selection
            </button>
          </div>
          <FileList files={stage.accepted} />
          <label className="field">
            Frames shot
            <span className="hint">
              A RAW + JPEG pair is one frame — we found {stage.detectedFrames}
            </span>
            <input
              name="frames"
              className="short"
              inputMode="numeric"
              value={String(declared)}
              onChange={(e) =>
                setFrames(Number.parseInt(e.target.value.replace(/\D/g, '') || '0', 10))
              }
            />
          </label>
          {mismatch ? (
            <Callout tone="bad" title="The frame count does not match">
              The selected files contain {stage.detectedFrames} frames. Add the missing files, or
              correct the count.
            </Callout>
          ) : null}
          <div className="divider" />
          <div className="spread">
            <span className="small muted">Keep this tab open while the upload runs.</span>
            <button type="button" onClick={() => onStart(declared)} disabled={mismatch}>
              <Icon name="upload" size="sm" />
              Start upload
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
