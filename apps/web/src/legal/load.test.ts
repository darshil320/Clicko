import { describe, expect, it } from 'vitest';
import { LEGAL, unresolvedFields } from './config';
import { publishedTerms } from './load';

// Audit C1 (14 Nov 2026): Vercel runs plain `build`, so the production site must refuse an
// unresolved Grievance Officer or address on its own (E-Commerce Rules 2020 r.4). Previews
// still deploy as drafts.
describe('publishedTerms', () => {
  it('the config still has fields waiting on the owner (this suite assumes so)', () => {
    expect(unresolvedFields(LEGAL).length).toBeGreaterThan(0);
  });

  it('refuses to publish on Vercel production while fields are unresolved', () => {
    expect(() => publishedTerms({ VERCEL: '1', VERCEL_ENV: 'production' })).toThrow(
      /cannot be published/,
    );
  });

  it('refuses under build:production (LEGAL_STRICT=1)', () => {
    expect(() => publishedTerms({ LEGAL_STRICT: '1' })).toThrow(/cannot be published/);
  });

  it('still renders a draft for Vercel previews and local builds', () => {
    expect(publishedTerms({ VERCEL: '1', VERCEL_ENV: 'preview' })).toContain('Grievance');
    expect(publishedTerms({})).toContain('Mehang Desai');
  });
});
