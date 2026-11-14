import { describe, expect, it } from 'vitest';
import { LEGAL_URLS } from './legal-urls';

// DPDP s.5 and E-Commerce Rules 2020 r.4: the notice, terms, refund policy and grievance
// contact must be one tap away in the app (audit H, 14 Nov 2026).
describe('LEGAL_URLS', () => {
  it('points every legal page at the live site over https', () => {
    expect(LEGAL_URLS).toEqual({
      terms: 'https://clickco.in/terms/',
      refunds: 'https://clickco.in/refund-policy/',
      privacy: 'https://clickco.in/privacy/',
      grievance: 'https://clickco.in/grievance/',
      deleteAccount: 'https://clickco.in/delete-account/',
    });
  });
});
