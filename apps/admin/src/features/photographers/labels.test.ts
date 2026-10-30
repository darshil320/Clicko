import { describe, expect, it } from 'vitest';
import { documentConsequence, moveTargets, statusConsequence } from './labels';

describe('moveTargets', () => {
  it('offers every other stage, decisions only to a city manager', () => {
    const ops = moveTargets('SCREENING', false);
    expect(ops).not.toContain('SCREENING');
    expect(ops).not.toContain('APPROVED');
    expect(ops).not.toContain('REJECTED');
    expect(ops).toContain('WITHDRAWN');
    expect(moveTargets('SCREENING', true)).toEqual(
      expect.arrayContaining(['APPROVED', 'REJECTED']),
    );
  });

  it('offers nothing once onboarded, and only a reopen after a rejection', () => {
    expect(moveTargets('APPROVED', true)).toEqual([]);
    expect(moveTargets('REJECTED', true)).not.toContain('APPROVED');
    expect(moveTargets('REJECTED', true)).toContain('SCREENING');
  });
});

describe('plain-language consequences', () => {
  it('says what a status change does to offers', () => {
    expect(statusConsequence('PAUSE', 'Asha')).toBe(
      'Asha stops getting new shoot offers. Shoots already assigned stay with them.',
    );
    expect(statusConsequence('OFFBOARD', 'Asha')).toContain('cannot be undone');
  });

  it('says which check a document ticks', () => {
    expect(documentConsequence('PAN_CARD', 'Asha')).toBe("Asha's PAN is marked verified.");
    expect(documentConsequence('PASSPORT', 'Asha')).toContain('identity is confirmed');
    expect(documentConsequence('OTHER', 'Asha')).toBe('The document is kept on file.');
  });
});
