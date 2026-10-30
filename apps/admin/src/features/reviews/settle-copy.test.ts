import { describe, expect, it } from 'vitest';
import { consequence } from './settle-copy';

describe('consequence', () => {
  const item = { clientName: 'Priya Sharma' };
  it('spells out every outcome in rupees and names the client', () => {
    expect(consequence(item, 'REFUND_REQUESTED', 250_000, 50_000)).toBe(
      'A refund of ₹2,500 to Priya Sharma goes to the Refunds desk, where a second person approves it. A ₹500 credit is issued to Priya Sharma now, valid for 12 months.',
    );
    expect(consequence(item, 'CREDIT_ISSUED', 30_000, 0)).toContain(
      'Priya Sharma gets a ₹300 credit',
    );
    expect(consequence(item, 'CHARGE_RAISED', 845_411, 0)).toContain(
      '₹8,454.11 is recorded as owed',
    );
    expect(consequence({ clientName: null }, 'NO_ACTION', 0, 0)).toBe(
      'This item is closed and no money moves.',
    );
  });
});
