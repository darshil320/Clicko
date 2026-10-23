import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DarktableCliAdapter, jpegDimensions } from '../export/darktable-cli.adapter';
import { DevPassthroughAdapter } from '../export/dev-passthrough.adapter';
import { JpegExportError } from '../export/jpeg-export.port';
import { PLACEHOLDER_NOTE, placeholderJpeg } from '../export/placeholder-jpeg';

let dir: string;
let raw: string;

/** A file that starts like a Canon CR3 (ISO box `ftypcrx `); the rest does not matter here. */
const CR3_HEADER = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypcrx ', 'latin1')]);

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'clickco-export-test-'));
  raw = join(dir, 'in.cr3');
  await writeFile(raw, Buffer.concat([CR3_HEADER, Buffer.alloc(64)]));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('placeholder JPEG (dev passthrough)', () => {
  it('is a valid JPEG (SOI … EOI) carrying the "export pending" note, 1×1 px', () => {
    const jpeg = placeholderJpeg();
    expect([...jpeg.subarray(0, 2)]).toEqual([0xff, 0xd8]);
    expect([...jpeg.subarray(-2)]).toEqual([0xff, 0xd9]);
    expect([...jpeg.subarray(2, 4)]).toEqual([0xff, 0xfe]); // COM right after SOI
    expect(jpeg.includes(Buffer.from(PLACEHOLDER_NOTE, 'latin1'))).toBe(true);
    expect(jpegDimensions(jpeg)).toEqual({ widthPx: 1, heightPx: 1 });
  });

  it('never reads the RAW and flags its output as a placeholder', async () => {
    const out = join(dir, 'pass.jpg');
    const result = await new DevPassthroughAdapter().exportRaw({
      inputPath: '/does/not/exist.CR3',
      outputPath: out,
    });
    expect(result).toEqual({
      sizeBytes: (await readFile(out)).length,
      widthPx: 1,
      heightPx: 1,
      isPlaceholder: true,
    });
  });
});

describe('DarktableCliAdapter (with a stand-in binary)', () => {
  const script = async (name: string, body: string) => {
    const path = join(dir, name);
    await writeFile(path, `#!/bin/sh\n${body}\n`);
    await chmod(path, 0o755);
    return path;
  };

  it('passes a neutral, preset-free argument list and reads the output dimensions', async () => {
    const argsFile = join(dir, 'args.txt');
    const sample = join(dir, 'sample.jpg');
    await writeFile(sample, placeholderJpeg('real export stand-in'));
    const fake = await script(
      'fake-darktable.sh',
      `printf '%s\\n' "$@" > "${argsFile}"\ncp "${sample}" "$2"`,
    );
    const out = join(dir, 'dt.jpg');
    const result = await new DarktableCliAdapter({
      binary: fake,
      timeoutMs: 10_000,
      quality: 92,
    }).exportRaw({
      inputPath: raw,
      outputPath: out,
    });
    expect(result).toMatchObject({ widthPx: 1, heightPx: 1, isPlaceholder: false });
    const args = (await readFile(argsFile, 'utf8')).trim().split('\n');
    expect(args.slice(0, 2)).toEqual([raw, out]);
    expect(args).toEqual(
      expect.arrayContaining([
        '--apply-custom-presets',
        'false',
        '--hq',
        'true',
        '--core',
        ':memory:',
      ]),
    );
    expect(args).toContain('plugins/imageio/format/jpeg/quality=92');
  });

  it('fails clearly when the binary is missing, exits non-zero, writes nothing or hangs', async () => {
    const missing = new DarktableCliAdapter({
      binary: join(dir, 'nope'),
      timeoutMs: 5_000,
      quality: 92,
    });
    await expect(
      missing.exportRaw({ inputPath: raw, outputPath: join(dir, 'x1.jpg') }),
    ).rejects.toThrow(/not found/);
    const failing = await script('fail.sh', 'echo "corrupt raw" >&2; exit 3');
    await expect(
      new DarktableCliAdapter({ binary: failing, timeoutMs: 5_000, quality: 92 }).exportRaw({
        inputPath: raw,
        outputPath: join(dir, 'x2.jpg'),
      }),
    ).rejects.toThrow(/exited 3: corrupt raw/);
    const silent = await script('silent.sh', 'exit 0');
    await expect(
      new DarktableCliAdapter({ binary: silent, timeoutMs: 5_000, quality: 92 }).exportRaw({
        inputPath: raw,
        outputPath: join(dir, 'x3.jpg'),
      }),
    ).rejects.toBeInstanceOf(JpegExportError);
    const slow = await script('slow.sh', 'sleep 5');
    await expect(
      new DarktableCliAdapter({ binary: slow, timeoutMs: 200, quality: 92 }).exportRaw({
        inputPath: raw,
        outputPath: join(dir, 'x4.jpg'),
      }),
    ).rejects.toThrow(/killed/);
  });

  it('gives the child none of the API environment (security review H3)', async () => {
    const envFile = join(dir, 'env.txt');
    const sample = join(dir, 'sample-env.jpg');
    await writeFile(sample, placeholderJpeg('env stand-in'));
    const fake = await script('env-darktable.sh', `env > "${envFile}"\ncp "${sample}" "$2"`);
    process.env.CLICKCO_TEST_SECRET = 'must-not-leak';
    try {
      await new DarktableCliAdapter({ binary: fake, timeoutMs: 10_000, quality: 92 }).exportRaw({
        inputPath: raw,
        outputPath: join(dir, 'env.jpg'),
      });
    } finally {
      delete process.env.CLICKCO_TEST_SECRET;
    }
    const env = await readFile(envFile, 'utf8');
    expect(env).not.toContain('must-not-leak');
    expect(env).not.toMatch(/DATABASE_URL|JWT_|RAZORPAY|OTP_HASH/);
    expect(env).toMatch(/^LANG=C\.UTF-8$/m);
  });

  it('refuses a file that is not the RAW it claims to be, without running darktable', async () => {
    const marker = join(dir, 'ran.txt');
    const fake = await script('never.sh', `touch "${marker}"`);
    const renamed = join(dir, 'renamed.cr3');
    await writeFile(renamed, '#!/bin/sh\necho pwned\n');
    await expect(
      new DarktableCliAdapter({ binary: fake, timeoutMs: 5_000, quality: 92 }).exportRaw({
        inputPath: renamed,
        outputPath: join(dir, 'x5.jpg'),
      }),
    ).rejects.toThrow(/does not look like/);
    await expect(readFile(marker)).rejects.toThrow();
  });
});
