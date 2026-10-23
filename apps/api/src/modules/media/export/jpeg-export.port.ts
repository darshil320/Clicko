/**
 * RAW → JPEG format conversion (v0.2 §3.2, ADR-0014 D4). Not editing: a neutral profile, no human,
 * no editorial judgment. Adapters work on local files; the worker streams bytes in and out of
 * StoragePort around them.
 */
export interface JpegExportInput {
  /** The RAW file on local disk (its original extension kept — converters sniff it). */
  readonly inputPath: string;
  /** Where to write the JPEG. */
  readonly outputPath: string;
}

export interface JpegExportResult {
  readonly sizeBytes: number;
  readonly widthPx: number | null;
  readonly heightPx: number | null;
  /**
   * True for the development passthrough: the output is a placeholder, not a conversion. Such an
   * asset is flagged in its row (`*.export-pending.jpg`, 1×1 px) and never exists in production.
   */
  readonly isPlaceholder: boolean;
}

export interface JpegExportPort {
  readonly id: 'darktable' | 'passthrough';
  exportRaw(input: JpegExportInput): Promise<JpegExportResult>;
}

export const JPEG_EXPORT_PORT = Symbol('JPEG_EXPORT_PORT');

/** Thrown when a conversion fails (missing binary, corrupt RAW, timeout). The job retries. */
export class JpegExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JpegExportError';
  }
}
