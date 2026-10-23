import { describe, expect, it } from 'vitest';
import { matchesFileSignature, SIGNATURE_PREFIX_BYTES } from '../file-signature';

const bytes = (...parts: ReadonlyArray<string | readonly number[]>): Buffer =>
  Buffer.concat(
    parts.map((p) => (typeof p === 'string' ? Buffer.from(p, 'latin1') : Buffer.from(p))),
  );
const pad = (b: Buffer): Buffer => Buffer.concat([b, Buffer.alloc(SIGNATURE_PREFIX_BYTES)]);

const TIFF_LE = pad(bytes([0x49, 0x49, 0x2a, 0x00, 0x08, 0, 0, 0]));
const TIFF_BE = pad(bytes([0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 0x08]));
const CR2 = pad(bytes([0x49, 0x49, 0x2a, 0x00, 0x10, 0, 0, 0], 'CR', [0x02, 0x00]));
const JPEG = pad(bytes([0xff, 0xd8, 0xff, 0xe1]));
const ftyp = (brand: string) => pad(bytes([0, 0, 0, 0x18], 'ftyp', brand));

describe('matchesFileSignature (security review M8: content, not the name)', () => {
  it.each([
    ['IMG_0001.JPG', JPEG],
    ['a.jpeg', JPEG],
    ['a.cr2', CR2],
    ['a.cr3', ftyp('crx ')],
    ['a.nef', TIFF_LE],
    ['a.nef', TIFF_BE],
    ['a.arw', TIFF_LE],
    ['a.dng', TIFF_BE],
    ['a.raf', pad(bytes('FUJIFILMCCD-RAW 0201'))],
    ['a.orf', pad(bytes('IIRO', [0x08, 0, 0, 0]))],
    ['a.orf', pad(bytes('MMOR', [0, 0, 0, 0x08]))],
    ['a.rw2', pad(bytes('IIU', [0x00, 0x18, 0, 0, 0]))],
    ['a.mp4', ftyp('isom')],
    ['a.m4v', ftyp('M4V ')],
    ['a.mov', ftyp('qt  ')],
    ['a.mov', pad(bytes([0, 0, 0, 0x08], 'wide'))],
    ['a.mts', pad(bytes([0, 0, 0, 0, 0x47]))],
    ['a.mts', pad(bytes([0x47, 0x40]))],
  ])('accepts a real %s header', (name, header) => {
    expect(matchesFileSignature(name, header)).toBe(true);
  });

  it.each([
    ['renamed.jpg', TIFF_LE],
    ['script.cr3', pad(bytes('#!/bin/sh\n'))],
    ['a.cr2', TIFF_LE],
    ['a.raf', JPEG],
    ['a.mp4', JPEG],
    ['a.nef', pad(bytes('<html>'))],
    ['a.jpg', Buffer.from([0xff, 0xd8])],
    ['a.txt', JPEG],
  ])('refuses %s with the wrong bytes', (name, header) => {
    expect(matchesFileSignature(name, header)).toBe(false);
  });
});
