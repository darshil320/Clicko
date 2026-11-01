import {
  AdminModerationFilter,
  ModerationDecision,
  ReporterKind,
  ReportReason,
  ReportStatus,
  ReportTargetKind,
} from '@clickco/contracts';
import { describe, expect, it } from 'vitest';
import {
  changedSinceReport,
  DECISION,
  decidedNotice,
  decisionConsequence,
  FILTER_LABEL,
  openReportsLabel,
  PERSON_KIND_LABEL,
  REASON_LABEL,
  reportedLabel,
  reportsClosedLabel,
  STATUS,
  starsLabel,
  TARGET_LABEL,
  warningsLabel,
} from './labels';

/** A label is written for people: not empty, and never the raw code. */
function expectWritten(code: string, label: string) {
  expect(label.trim()).not.toBe('');
  expect(label).not.toBe(code);
  expect(label).not.toMatch(/_/);
}

describe('labels', () => {
  it('writes every reason, target, person kind and filter in words', () => {
    for (const r of ReportReason.options) expectWritten(r, REASON_LABEL[r]);
    for (const t of ReportTargetKind.options) expectWritten(t, TARGET_LABEL[t]);
    for (const k of ReporterKind.options) expectWritten(k, PERSON_KIND_LABEL[k]);
    for (const f of AdminModerationFilter.options) expectWritten(f, FILTER_LABEL[f]);
  });

  it('writes every decision, and confirms only the ones that act on the target', () => {
    for (const d of ModerationDecision.options) {
      expectWritten(d, DECISION[d].label);
      expectWritten(d, DECISION[d].action);
      expectWritten(d, DECISION[d].done);
    }
    expect(ModerationDecision.options.filter((d) => DECISION[d].confirms)).toEqual([
      'HIDE',
      'WARN',
    ]);
  });

  it('gives every status a word and a tone', () => {
    for (const s of ReportStatus.options) {
      expectWritten(s, STATUS[s].label);
      expect(STATUS[s].tone).toBeTruthy();
    }
    expect(STATUS.OPEN.tone).toBe('warning');
  });
});

describe('reportedLabel', () => {
  it('names a review by the photographer it is about', () => {
    expect(reportedLabel({ targetKind: 'REVIEW', targetName: 'Asha Patel' })).toBe(
      'Review of Asha Patel',
    );
  });

  it('names a person with their kind', () => {
    expect(reportedLabel({ targetKind: 'USER', targetName: 'Rohan Shah' })).toBe(
      'Client Rohan Shah',
    );
    expect(reportedLabel({ targetKind: 'PHOTOGRAPHER', targetName: 'Asha Patel' })).toBe(
      'Photographer Asha Patel',
    );
  });

  it('falls back to the kind when the name is unknown', () => {
    expect(reportedLabel({ targetKind: 'PHOTOGRAPHER', targetName: null })).toBe('A photographer');
    expect(reportedLabel({ targetKind: 'REVIEW', targetName: null })).toBe('A review');
  });
});

describe('counts in words', () => {
  it('reads stars as text', () => {
    expect(starsLabel(1)).toBe('1 of 5');
  });

  it('pluralises warnings and open reports', () => {
    expect(warningsLabel(0)).toBe('No warnings yet');
    expect(warningsLabel(1)).toBe('1 warning');
    expect(warningsLabel(3)).toBe('3 warnings');
    expect(openReportsLabel(0)).toBe('None');
    expect(openReportsLabel(1)).toBe('1 open report');
    expect(openReportsLabel(2)).toBe('2 open reports');
    expect(reportsClosedLabel(1)).toBe('1 report closed');
    expect(reportsClosedLabel(3)).toBe('3 reports closed');
  });
});

describe('decisionConsequence', () => {
  const base = {
    targetKind: 'REVIEW',
    authorName: 'Rohan Shah',
    photographerName: 'Asha Patel',
    personName: 'Rohan Shah',
    personWarnings: 0,
    otherOpenReports: 0,
  } as const;

  it('says whose review is hidden and whose rating it leaves', () => {
    expect(decisionConsequence({ ...base, decision: 'HIDE' })).toBe(
      "Rohan Shah's review of Asha Patel will be hidden from the app and stop counting in Asha Patel's rating. The report closes.",
    );
  });

  it('still reads when names are unknown', () => {
    expect(
      decisionConsequence({ ...base, decision: 'HIDE', authorName: null, photographerName: null }),
    ).toBe(
      "The client's review will be hidden from the app and stop counting in the photographer's rating. The report closes.",
    );
  });

  it('says who is warned and how many warnings they will have', () => {
    expect(decisionConsequence({ ...base, decision: 'WARN' })).toBe(
      "A warning goes on Rohan Shah's record (their first). The review stays up. The report closes.",
    );
    expect(
      decisionConsequence({
        ...base,
        decision: 'WARN',
        targetKind: 'PHOTOGRAPHER',
        personName: 'Asha Patel',
        personWarnings: 2,
      }),
    ).toBe("A warning goes on Asha Patel's record (3 in total). The report closes.");
  });

  it('names the other open reports a decision closes', () => {
    expect(decisionConsequence({ ...base, decision: 'DISMISS', otherOpenReports: 1 })).toBe(
      'No action is taken. This report and 1 other open report on the same target close.',
    );
    expect(decisionConsequence({ ...base, decision: 'KEEP', otherOpenReports: 2 })).toBe(
      'Nothing changes for the review. This report and 2 other open reports on the same target close.',
    );
  });
});

describe('decidedNotice', () => {
  it('names what was reported and the decision', () => {
    expect(decidedNotice('HIDE', 'Review of Asha Patel')).toBe('Review of Asha Patel: hidden');
  });
});

describe('changedSinceReport', () => {
  it('only when a snapshot exists and the rating or comment differs', () => {
    const now = { rating: 4, comment: 'Lovely' };
    expect(changedSinceReport(now, null)).toBe(false);
    expect(changedSinceReport(now, { rating: 4, comment: 'Lovely' })).toBe(false);
    expect(changedSinceReport(now, { rating: 1, comment: 'Lovely' })).toBe(true);
    expect(changedSinceReport(now, { rating: 4, comment: null })).toBe(true);
  });
});
