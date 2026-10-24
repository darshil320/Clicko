'use client';

import { JPEG_EXTENSIONS, RAW_EXTENSIONS } from '@clickco/contracts';
import { type ChangeEvent, type DragEvent, useState } from 'react';
import { Icon } from '../../shared/icons';
import { summariseRejections } from './file-filter';
import { filesFromDrop, filesFromInput } from './folder-drop';
import type { SourceFile } from './uploader';

const ACCEPT = [...RAW_EXTENSIONS, ...JPEG_EXTENSIONS].join(',');
/** React has no type for the non-standard folder-picker attribute. */
const FOLDER_PICKER = { webkitdirectory: '', directory: '' } as Record<string, string>;
const RAW_LABEL = RAW_EXTENSIONS.map((e) => e.slice(1).toUpperCase()).join(' ');

type OnFiles = (files: SourceFile[]) => void;

/** Picker change: hand over the files, then reset so picking the same folder again still fires. */
const picked = (onFiles: OnFiles) => (e: ChangeEvent<HTMLInputElement>) => {
  const files = filesFromInput(e.target.files);
  e.target.value = '';
  onFiles(files);
};

/**
 * The folder drop target (doc 02 §7). Keyboard users reach the two pickers inside it: each is a
 * real (visually hidden) file input inside its button-styled label.
 */
export function DropZone({
  onFiles,
  title,
}: {
  readonly onFiles: OnFiles;
  readonly title: string;
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
  const heading = reading ? 'Reading the folder…' : active ? 'Release to add the files' : title;
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a drag-and-drop target; keyboard users use the file and folder pickers inside it
    <div
      className={active ? 'drop active' : 'drop'}
      onDragOver={(e) => {
        e.preventDefault();
        setActive(true);
      }}
      onDragLeave={(e) => {
        // Moving over a child fires dragleave on the zone: only leaving the zone itself counts.
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setActive(false);
      }}
      onDrop={onDrop}
      data-testid="drop-zone"
    >
      <span className="drop-bg dots fade-mask" aria-hidden="true" />
      <span className="tile lg round drop-icon" aria-hidden="true">
        {reading ? <span className="spinner" /> : <Icon name="upload" size="lg" />}
      </span>
      <div className="stack tight">
        <span className="drop-title" aria-live="polite">
          {heading}
        </span>
        <span className="small">or choose them from your computer</span>
      </div>
      <div className="row center">
        <label className="button secondary">
          <Icon name="files" size="sm" />
          Choose files
          <input
            type="file"
            multiple
            accept={ACCEPT}
            className="visually-hidden"
            data-testid="file-input"
            onChange={picked(onFiles)}
          />
        </label>
        <label className="button secondary">
          <Icon name="card" size="sm" />
          Choose card folder
          <input
            type="file"
            multiple
            className="visually-hidden"
            {...FOLDER_PICKER}
            onChange={picked(onFiles)}
          />
        </label>
      </div>
      <p className="formats">
        <span>RAW {RAW_LABEL}</span>
        <span aria-hidden="true">·</span>
        <span>JPEG</span>
        <span aria-hidden="true">·</span>
        <span>Everything else is skipped</span>
      </p>
    </div>
  );
}

export function Rejections({
  rejected,
}: {
  readonly rejected: Parameters<typeof summariseRejections>[0];
}) {
  if (rejected.length === 0) return null;
  return (
    <div className="callout warn">
      <Icon name="alert" />
      <div>
        <strong>
          {rejected.length} {rejected.length === 1 ? 'file' : 'files'} skipped
        </strong>
        <ul className="plain small">
          {summariseRejections(rejected).map((g) => (
            <li key={g.reason}>
              <span>{g.message}</span>
              <span className="muted">
                {' '}
                — {g.names.slice(0, 5).join(', ')}
                {g.names.length > 5 ? ` and ${g.names.length - 5} more` : ''}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
