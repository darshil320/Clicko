import { describe, expect, it } from 'vitest';
import { documentHref } from './document-href';

const ORIGIN = 'https://admin.clickco.in';

describe('documentHref (audit M2)', () => {
  it('passes only an object URL of this origin', () => {
    const url = `blob:${ORIGIN}/3f0c2a9e-1c1d-4c55-9b8a-0b6c7a1d2e3f`;
    expect(documentHref(url, ORIGIN)).toBe(url);
  });

  it('refuses provider links, scripts, data URLs and other origins', () => {
    expect(documentHref('https://drive.google.com/file/d/x', ORIGIN)).toBeNull();
    expect(documentHref('javascript:alert(1)', ORIGIN)).toBeNull();
    expect(documentHref('data:application/pdf;base64,AA', ORIGIN)).toBeNull();
    expect(documentHref('blob:https://evil.example/1', ORIGIN)).toBeNull();
    expect(documentHref(null, ORIGIN)).toBeNull();
    expect(documentHref('blob:/x', '')).toBeNull();
  });
});
