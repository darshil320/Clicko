import { describe, expect, it } from 'vitest';
import { signInPath } from './sign-out';

describe('signInPath', () => {
  it('carries the reason and where to return', () => {
    expect(signInPath('idle', '/qa')).toBe('/sign-in?reason=idle&next=%2Fqa');
    expect(signInPath('manual')).toBe('/sign-in');
  });

  it('never returns to another origin', () => {
    expect(signInPath('expired', '//evil.example/x')).toBe('/sign-in?reason=expired');
    expect(signInPath('expired', 'https://evil.example')).toBe('/sign-in?reason=expired');
  });
});
