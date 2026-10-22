import { describe, expect, it } from 'vitest';
import { LEGAL } from './config';
import { extractSection, loadTerms, renderTerms } from './render';

const complete = {
  ...LEGAL,
  registeredAddress: '12 Ring Road',
  privacyEmail: 'privacy@clickco.in',
  grievanceOfficer: {
    name: 'Ananya Iyer',
    email: 'grievance@clickco.in',
    phone: '+91 98765 43210',
    address: '12 Ring Road, Surat',
  },
};

describe('renderTerms', () => {
  const source = loadTerms();

  it('fills the entity name and leaves no square-bracket placeholder behind', () => {
    const md = renderTerms(source, complete, { strict: true });
    expect(md).toContain('Operated by Clicko, 12 Ring Road, Surat, Gujarat');
    expect(md).not.toMatch(/\[[A-Z][A-Za-z ,/—.\-0-9]*\]/);
  });

  it('states prices are exclusive of GST', () => {
    expect(renderTerms(source, complete)).toContain('Prices displayed are exclusive of GST');
  });

  it('publishes the peak-season dates instead of a placeholder (T&C §3.2)', () => {
    const md = renderTerms(source, complete);
    expect(md).toContain('1 Nov – 28 Feb');
    expect(md).not.toContain('LIST SPECIFIC DATE RANGES');
  });

  it('caps equipment liability at ₹2,00,000', () => {
    expect(renderTerms(source, complete)).toContain('₹2,00,000 per incident');
  });

  it('drops the reviewer note and the changelog from the published page', () => {
    const md = renderTerms(source, complete);
    expect(md).not.toContain('Not legal advice');
    expect(md).not.toContain('CHANGELOG');
    expect(md).not.toContain('Fields you need to fill');
  });

  it('marks unresolved fields visibly in a draft build', () => {
    expect(renderTerms(source, LEGAL)).toContain('To be confirmed');
  });

  it('refuses a strict (production) build while any field is unresolved', () => {
    expect(() => renderTerms(source, LEGAL, { strict: true })).toThrow(/registeredAddress/);
  });

  it('fails loudly if the spec text changes under a placeholder', () => {
    expect(() => renderTerms('no placeholders here', complete)).toThrow(/placeholder/);
  });
});

describe('extractSection', () => {
  const md = renderTerms(loadTerms(), complete);

  it('returns the refund ladder for the refund-policy page', () => {
    const s3 = extractSection(md, 3);
    expect(s3.startsWith('## 3. Cancellation')).toBe(true);
    expect(s3).toContain('Less than 24 hours before shoot');
    expect(s3).not.toContain('## 4.');
  });

  it('fails loudly on a missing section', () => {
    expect(() => extractSection(md, 99)).toThrow(/99/);
  });
});
