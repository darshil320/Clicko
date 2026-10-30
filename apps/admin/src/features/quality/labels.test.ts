import { describe, expect, it } from 'vitest';
import { decisionConsequence } from './labels';

describe('decisionConsequence', () => {
  const base = { amountPaise: 250_000, clientName: 'Rohan Shah', reference: 'CLK-1004' };

  it('names the amount, the person and where the money goes', () => {
    expect(decisionConsequence({ ...base, outcome: 'CREDIT' })).toBe(
      'A ₹2,500 credit for Rohan Shah goes to "To settle" for approval. The issue and booking CLK-1004 close.',
    );
    expect(decisionConsequence({ ...base, outcome: 'PARTIAL_REFUND' })).toContain(
      'refund to Rohan Shah',
    );
  });

  it('says what happens when no money moves', () => {
    expect(decisionConsequence({ ...base, outcome: 'RESHOOT' })).toContain('free reshoot');
    expect(decisionConsequence({ ...base, outcome: 'NO_ACTION' })).toContain('no compensation');
  });
});
