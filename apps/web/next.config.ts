import type { NextConfig } from 'next';

// Static export: the legal-pages site is plain HTML on Vercel/Cloudflare (ADR-0008).
const config: NextConfig = { output: 'export', trailingSlash: true };
export default config;
