import { LEGAL } from './config';
import { loadTerms, renderTerms } from './render';

/** Build-time entry point. LEGAL_STRICT=1 (build:production) refuses unresolved fields. */
export function publishedTerms(): string {
  return renderTerms(loadTerms(), LEGAL, { strict: process.env.LEGAL_STRICT === '1' });
}
