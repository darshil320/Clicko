import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';
import { isDeployBuild, resolveApiBase } from './src/lib/api-base';
import { cspApiProblem, readVercelJson } from './src/lib/security-headers';

// A deploy build fails fast on a bad API URL, or on one the CSP in vercel.json would block
// (audit M1/M2): the waitlist form posts there and the delivery page (/d/<token>, ADR-0027 D6c)
// reads from it. Without an API URL the site shows "Waitlist opens soon" and the delivery page an
// error, and neither ever calls localhost.
const api = resolveApiBase(process.env);
if (api.kind === 'live' && isDeployBuild(process.env)) {
  const problem = cspApiProblem(
    readVercelJson(fileURLToPath(new URL('./vercel.json', import.meta.url))),
    api.base,
  );
  if (problem) throw new Error(problem);
}

// Static export: the legal-pages site is plain HTML on Vercel/Cloudflare (ADR-0008). /d/<token>
// is one exported page that vercel.json rewrites every token to.
const config: NextConfig = { output: 'export', trailingSlash: true };
export default config;
