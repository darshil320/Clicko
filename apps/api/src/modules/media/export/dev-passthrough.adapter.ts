import { writeFile } from 'node:fs/promises';
import type { JpegExportInput, JpegExportPort, JpegExportResult } from './jpeg-export.port';
import { placeholderJpeg } from './placeholder-jpeg';

/**
 * Development/test only (config/env.ts refuses it in staging and production). It does not decode the
 * RAW: it writes a tiny valid placeholder JPEG so the pipeline (PROCESSING → QA) can be exercised on
 * a machine without darktable. The worker flags the asset row (`*.export-pending.jpg`, 1×1 px).
 */
export class DevPassthroughAdapter implements JpegExportPort {
  readonly id = 'passthrough' as const;

  async exportRaw(input: JpegExportInput): Promise<JpegExportResult> {
    const jpeg = placeholderJpeg();
    await writeFile(input.outputPath, jpeg, { flag: 'wx' });
    return { sizeBytes: jpeg.length, widthPx: 1, heightPx: 1, isPlaceholder: true };
  }
}
