import { isProductionBuild } from '../lib/api-base';
import { LEGAL } from './config';
import { loadTerms, renderTerms } from './render';

type BuildEnv = Readonly<Record<string, string | undefined>>;

/**
 * Build-time entry point. The production site (Vercel production, CLICKCO_DEPLOY=1 or
 * `build:production`) refuses unresolved legal fields; previews and local builds render a draft.
 */
export function publishedTerms(env: BuildEnv = process.env): string {
  return renderTerms(loadTerms(), LEGAL, { strict: isProductionBuild(env) });
}
