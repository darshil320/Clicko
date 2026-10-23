import type { NextConfig } from 'next';
import { resolveApiUrl, STATIC_SECURITY_HEADERS } from './src/shared/security-headers';

// A deploy build fails fast without an https API URL (security review L7).
resolveApiUrl(process.env.NEXT_PUBLIC_API_URL, process.env.CLICKCO_DEPLOY === '1');

const config: NextConfig = {
  transpilePackages: ['@clickco/contracts', '@clickco/api-client', '@clickco/design-tokens'],
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: [...STATIC_SECURITY_HEADERS] }];
  },
};
export default config;
