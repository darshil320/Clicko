import { describe, expect, it } from 'vitest';
import { allowedDecisions, personWarned, reportTargetAllowed } from '../safety-rules';

const PERSON = '7d9f3c1a-2b4e-4c8d-9f10-1a2b3c4d5e6f';
const AUTHOR = '8e0a4d2b-3c5f-4d9e-8a21-2b3c4d5e6f70';

describe('who may report what (ADR-0027 D4)', () => {
  it('anyone reports a review; a client a photographer; a photographer a client', () => {
    expect(reportTargetAllowed('USER', 'REVIEW')).toBe(true);
    expect(reportTargetAllowed('PHOTOGRAPHER', 'REVIEW')).toBe(true);
    expect(reportTargetAllowed('USER', 'PHOTOGRAPHER')).toBe(true);
    expect(reportTargetAllowed('PHOTOGRAPHER', 'USER')).toBe(true);
    expect(reportTargetAllowed('USER', 'USER')).toBe(false);
    expect(reportTargetAllowed('PHOTOGRAPHER', 'PHOTOGRAPHER')).toBe(false);
  });
});

describe('what a report can be decided as', () => {
  it('a shown review: hide, keep, warn its author, dismiss', () => {
    expect(
      allowedDecisions({ status: 'OPEN', targetKind: 'REVIEW' }, { isPublished: true }),
    ).toEqual(['HIDE', 'KEEP', 'WARN', 'DISMISS']);
  });

  it('a review already hidden cannot be hidden or kept again', () => {
    expect(
      allowedDecisions({ status: 'OPEN', targetKind: 'REVIEW' }, { isPublished: false }),
    ).toEqual(['WARN', 'DISMISS']);
  });

  it('a person: warn or dismiss', () => {
    for (const targetKind of ['USER', 'PHOTOGRAPHER'] as const) {
      expect(allowedDecisions({ status: 'OPEN', targetKind }, null)).toEqual(['WARN', 'DISMISS']);
    }
  });

  it('nothing once decided', () => {
    expect(
      allowedDecisions({ status: 'ACTIONED', targetKind: 'REVIEW' }, { isPublished: false }),
    ).toEqual([]);
    expect(allowedDecisions({ status: 'DISMISSED', targetKind: 'USER' }, null)).toEqual([]);
  });
});

describe('who a warning goes to', () => {
  it("a review's author, or the reported person", () => {
    expect(personWarned({ targetKind: 'REVIEW', targetId: PERSON }, AUTHOR)).toEqual({
      kind: 'USER',
      id: AUTHOR,
    });
    expect(personWarned({ targetKind: 'USER', targetId: PERSON }, null)).toEqual({
      kind: 'USER',
      id: PERSON,
    });
    expect(personWarned({ targetKind: 'PHOTOGRAPHER', targetId: PERSON }, null)).toEqual({
      kind: 'PHOTOGRAPHER',
      id: PERSON,
    });
    expect(personWarned({ targetKind: 'REVIEW', targetId: PERSON }, null)).toBeNull();
  });
});
