import type { DeliveryFolderView } from '@clickco/contracts/delivery';
import {
  downloadUrl,
  fileCount,
  formatBytes,
  formatIstDateTime,
  KIND_COPY,
  timeLeft,
} from '../../lib/delivery';
import { Icon } from '../ui/Icon';

interface DeliveryFilesProps {
  readonly folder: DeliveryFolderView;
  readonly apiBase: string;
  readonly token: string;
  readonly now: Date;
}

/**
 * One delivery link's files. Each download is a plain link to the API's
 * /d/<token>/files/<id>: the API streams the bytes as an attachment, so the browser saves the
 * file and this page stays open. No Referer goes with it (the page's URL carries the token).
 */
export function DeliveryFiles({ folder, apiBase, token, now }: DeliveryFilesProps) {
  const copy = KIND_COPY[folder.kind];
  const left = timeLeft(folder.expiresAt, now);
  const total = `${fileCount(folder.fileCount)} · ${formatBytes(folder.totalBytes)}`;
  return (
    <>
      <div className="hero-copy">
        <p className="pill">Booking {folder.bookingReference}</p>
        <h1 id="delivery-title">{copy.title}</h1>
        <p className="lead">
          Save each file before this link closes on {formatIstDateTime(folder.expiresAt)}
          {left ? ` (${left})` : ''}.
        </p>
        <ul className="facts">
          <li>
            <Icon name="layers" />
            <strong>{total}</strong>
          </li>
          <li>
            <Icon name="shield" />
            Private link: anyone you forward it to can download these files.
          </li>
        </ul>
      </div>
      {folder.files.length === 0 ? (
        <div className="notice gap-top delivery-note" role="status">
          <p>There are no files on this link any more.</p>
        </div>
      ) : (
        <ul className="delivery-files" aria-label="Files">
          {folder.files.map((file) => (
            <li className="delivery-file" key={file.id}>
              <p className="delivery-file-name">{file.name}</p>
              <p className="delivery-file-size">{formatBytes(file.sizeBytes)}</p>
              <a
                className="btn btn-secondary btn-sm"
                href={downloadUrl(apiBase, token, file.id)}
                rel="noreferrer"
                aria-label={`Download ${file.name} (${formatBytes(file.sizeBytes)})`}
              >
                <Icon name="download" />
                Download
              </a>
            </li>
          ))}
        </ul>
      )}
      {copy.note ? (
        <div className="notice gap-top delivery-note">
          <p>{copy.note}</p>
        </div>
      ) : null}
    </>
  );
}
