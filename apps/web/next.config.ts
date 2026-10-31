import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';
import { cspApiProblem, readVercelJson } from './src/lib/security-headers';
import { isDeployBuild, resolveWaitlist } from './src/lib/waitlist';

// A deploy build fails fast on a bad API URL, or on one the CSP in vercel.json would block
// (audit M1/M2). Without an API URL the site shows "Waitlist opens soon" instead of a form.
const waitlist = resolveWaitlist(process.env);
if (waitlist.kind === 'live' && isDeployBuild(process.env)) {
  const problem = cspApiProblem(
    readVercelJson(fileURLToPath(new URL('./vercel.json', import.meta.url))),
    waitlist.endpoint,
  );
  if (problem) throw new Error(problem);
}

// Static export: the legal-pages site is plain HTML on Vercel/Cloudflare (ADR-0008).
const config: NextConfig = { output: 'export', trailingSlash: true };
export default config;
