/**
 * Streaming SHA-256 (FIPS 180-4). WebCrypto has no incremental digest, and a card file must be
 * hashed part by part as it is read (ADR-0014 D3) — an 18 GB upload cannot be held in memory.
 * Pure TypeScript, no dependencies; checked against Node's crypto in sha256.test.ts.
 */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const INITIAL = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
] as const;

export class Sha256 {
  private readonly state = new Uint32Array(INITIAL);
  private readonly block = new Uint8Array(64);
  private readonly words = new Uint32Array(64);
  private blockLength = 0;
  private bytesHashed = 0;
  private finished = false;

  update(data: Uint8Array): this {
    if (this.finished) throw new Error('Sha256: update after digest');
    this.bytesHashed += data.length;
    this.absorb(data);
    return this;
  }

  digest(): Uint8Array {
    if (!this.finished) {
      const bitsHigh = Math.floor(this.bytesHashed / 0x20000000);
      const bitsLow = (this.bytesHashed * 8) >>> 0;
      const padLength = this.blockLength < 56 ? 56 - this.blockLength : 120 - this.blockLength;
      const pad = new Uint8Array(padLength + 8);
      pad[0] = 0x80;
      const view = new DataView(pad.buffer);
      view.setUint32(padLength, bitsHigh >>> 0, false);
      view.setUint32(padLength + 4, bitsLow, false);
      this.absorb(pad);
      this.finished = true;
    }
    const out = new Uint8Array(32);
    const view = new DataView(out.buffer);
    for (let i = 0; i < 8; i++) view.setUint32(i * 4, this.state[i] as number, false);
    return out;
  }

  hex(): string {
    return toHex(this.digest());
  }

  /** Feeds bytes through the 64-byte block buffer without counting them. */
  private absorb(data: Uint8Array): void {
    let offset = 0;
    if (this.blockLength > 0) {
      const take = Math.min(64 - this.blockLength, data.length);
      this.block.set(data.subarray(0, take), this.blockLength);
      this.blockLength += take;
      offset = take;
      if (this.blockLength < 64) return;
      this.compress(this.block, 0);
      this.blockLength = 0;
    }
    while (data.length - offset >= 64) {
      this.compress(data, offset);
      offset += 64;
    }
    if (offset < data.length) {
      this.block.set(data.subarray(offset), 0);
      this.blockLength = data.length - offset;
    }
  }

  private compress(data: Uint8Array, offset: number): void {
    const w = this.words;
    for (let i = 0; i < 16; i++) {
      const j = offset + i * 4;
      w[i] =
        (((data[j] as number) << 24) |
          ((data[j + 1] as number) << 16) |
          ((data[j + 2] as number) << 8) |
          (data[j + 3] as number)) >>>
        0;
    }
    for (let i = 16; i < 64; i++) {
      const w15 = w[i - 15] as number;
      const w2 = w[i - 2] as number;
      const s0 = ((w15 >>> 7) | (w15 << 25)) ^ ((w15 >>> 18) | (w15 << 14)) ^ (w15 >>> 3);
      const s1 = ((w2 >>> 17) | (w2 << 15)) ^ ((w2 >>> 19) | (w2 << 13)) ^ (w2 >>> 10);
      w[i] = ((w[i - 16] as number) + s0 + (w[i - 7] as number) + s1) >>> 0;
    }
    const s = this.state;
    let a = s[0] as number;
    let b = s[1] as number;
    let c = s[2] as number;
    let d = s[3] as number;
    let e = s[4] as number;
    let f = s[5] as number;
    let g = s[6] as number;
    let h = s[7] as number;
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + (K[i] as number) + (w[i] as number)) >>> 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    s[0] = ((s[0] as number) + a) >>> 0;
    s[1] = ((s[1] as number) + b) >>> 0;
    s[2] = ((s[2] as number) + c) >>> 0;
    s[3] = ((s[3] as number) + d) >>> 0;
    s[4] = ((s[4] as number) + e) >>> 0;
    s[5] = ((s[5] as number) + f) >>> 0;
    s[6] = ((s[6] as number) + g) >>> 0;
    s[7] = ((s[7] as number) + h) >>> 0;
  }
}

export function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

/** One-shot convenience (tests, small buffers). */
export const sha256Hex = (data: Uint8Array): string => new Sha256().update(data).hex();
