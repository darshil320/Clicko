import { describe, expect, it } from 'vitest';
import { LEGAL_PATHS } from '../content/site';
import { LEGAL } from './config';
import { legalContent } from './content';

describe('legalContent', () => {
  it('fills every placeholder in the privacy notice', () => {
    const md = legalContent('privacy');
    expect(md).not.toMatch(/\{\{[A-Z_]+\}\}/);
    expect(md).toContain(LEGAL.entityName);
  });

  // DPDP s.5(1), Rule 3: the notice must name the rights, how to withdraw consent and the Board.
  it('the privacy notice names the Board, nomination, withdrawal and the 18+ rule', () => {
    const md = legalContent('privacy');
    expect(md).toContain('Data Protection Board of India');
    expect(md).toMatch(/Nominate/);
    expect(md).toMatch(/withdraw any consent/i);
    expect(md).toMatch(/aged 18 or over/);
    expect(md).toMatch(/Razorpay/);
    expect(md).toMatch(/outside India/);
    expect(md).toMatch(/Verification documents/);
  });

  // Google Play User Data policy: a web page that explains how to delete an account.
  it('the deletion page explains the in-app path, the web path and what is kept', () => {
    const md = legalContent('delete-account');
    expect(md).not.toMatch(/\{\{[A-Z_]+\}\}/);
    expect(md).toMatch(/Profile/);
    expect(md).toContain(LEGAL.privacyEmail);
    expect(md).toMatch(/72 months/);
  });

  it('lists the deletion page among the legal pages (sitemap, footer)', () => {
    expect(LEGAL_PATHS).toContain('/delete-account/');
  });
});
