import { spawn } from 'node:child_process';
import { mkdtemp, open, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { matchesFileSignature, SIGNATURE_PREFIX_BYTES } from '../file-signature';
import {
  JpegExportError,
  type JpegExportInput,
  type JpegExportPort,
  type JpegExportResult,
} from './jpeg-export.port';

export interface DarktableOptions {
  /** DARKTABLE_CLI_PATH (default `darktable-cli`, resolved on `searchPath`). */
  readonly binary: string;
  /** The child's PATH; defaults to the system directories. */
  readonly searchPath?: string;
  readonly timeoutMs: number;
  /** JPEG quality 1–100. */
  readonly quality: number;
}

const STDERR_LIMIT = 4_096;
const SYSTEM_PATH = '/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin';

/**
 * Security review H3: darktable parses untrusted RAW files, so it inherits none of the API's
 * environment (database URL, signing keys, provider secrets) — only a PATH, a throwaway HOME and
 * a locale. Isolation proper (own image, no network, memory/CPU limits) is the worker's deployment.
 */
export function darktableEnv(home: string, searchPath = SYSTEM_PATH): NodeJS.ProcessEnv {
  return { PATH: searchPath, HOME: home, TMPDIR: home, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' };
}

/** Width/height from the first SOFn marker of a JPEG header, or nulls if it cannot be read. */
export function jpegDimensions(header: Buffer): {
  widthPx: number | null;
  heightPx: number | null;
} {
  let i = 2; // after SOI
  while (i + 9 < header.length) {
    if (header[i] !== 0xff) return { widthPx: null, heightPx: null };
    const marker = header[i + 1] as number;
    const length = header.readUInt16BE(i + 2);
    const isSof = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isSof) return { heightPx: header.readUInt16BE(i + 5), widthPx: header.readUInt16BE(i + 7) };
    i += 2 + length;
  }
  return { widthPx: null, heightPx: null };
}

async function readHeader(path: string, bytes = 65_536): Promise<Buffer> {
  const handle = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/**
 * RAW → full-resolution JPEG with darktable-cli and a neutral profile (v0.2 §3.2): no user presets
 * (`--apply-custom-presets false`), high-quality processing, an in-memory library and a throwaway
 * config dir so nothing from a previous run or another user leaks in. Spawned with an argument array
 * (never a shell). Deployment: the worker image must carry darktable ≥ 4.6 (ADR-0008, ADR-0014 D4).
 */
export class DarktableCliAdapter implements JpegExportPort {
  readonly id = 'darktable' as const;

  constructor(private readonly options: DarktableOptions) {}

  async exportRaw(input: JpegExportInput): Promise<JpegExportResult> {
    const header = await readHeader(input.inputPath, SIGNATURE_PREFIX_BYTES);
    if (!matchesFileSignature(input.inputPath, header)) {
      throw new JpegExportError('The input does not look like the RAW format its name claims');
    }
    const configDir = await mkdtemp(join(tmpdir(), 'clickco-darktable-'));
    try {
      await this.run(configDir, [
        input.inputPath,
        input.outputPath,
        '--hq',
        'true',
        '--apply-custom-presets',
        'false',
        '--core',
        '--library',
        ':memory:',
        '--configdir',
        configDir,
        '--conf',
        `plugins/imageio/format/jpeg/quality=${this.options.quality}`,
      ]);
      const size = (await stat(input.outputPath).catch(() => null))?.size ?? 0;
      if (size === 0) throw new JpegExportError('darktable-cli finished without writing a JPEG');
      return {
        sizeBytes: size,
        ...jpegDimensions(await readHeader(input.outputPath)),
        isPlaceholder: false,
      };
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  }

  private run(home: string, args: readonly string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.options.binary, args, {
        env: darktableEnv(home, this.options.searchPath),
        stdio: ['ignore', 'ignore', 'pipe'],
        timeout: this.options.timeoutMs,
        killSignal: 'SIGKILL',
      });
      let stderr = '';
      child.stderr?.on('data', (chunk: Buffer) => {
        if (stderr.length < STDERR_LIMIT) stderr += chunk.toString('utf8').slice(0, STDERR_LIMIT);
      });
      child.on('error', (error: NodeJS.ErrnoException) =>
        reject(
          new JpegExportError(
            error.code === 'ENOENT'
              ? `darktable-cli not found at "${this.options.binary}" — the export worker image must include darktable`
              : `darktable-cli could not start: ${error.message}`,
          ),
        ),
      );
      // 'exit', not 'close': a grandchild holding stderr open must not outlive the timeout.
      child.on('exit', (code, signal) => {
        if (code === 0) return resolve();
        const why = signal
          ? `was killed (${signal}, limit ${this.options.timeoutMs} ms)`
          : `exited ${code}`;
        reject(new JpegExportError(`darktable-cli ${why}: ${stderr.trim().slice(0, 500)}`));
      });
    });
  }
}
