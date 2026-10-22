import { describe, expect, it } from 'vitest';
import { gstStateCode } from '../gst-state-codes';

describe('gstStateCode', () => {
  it('maps the launch states', () => {
    expect(gstStateCode('Gujarat')).toBe('24');
    expect(gstStateCode('Maharashtra')).toBe('27');
  });

  it('is case- and ampersand-insensitive', () => {
    expect(gstStateCode('  jammu & kashmir ')).toBe('01');
  });

  it('fails loudly on an unknown state', () => {
    expect(() => gstStateCode('Atlantis')).toThrow(/Atlantis/);
  });
});
