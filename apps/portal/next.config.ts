import type { NextConfig } from 'next';

const config: NextConfig = {
  transpilePackages: ['@clickco/contracts', '@clickco/api-client', '@clickco/design-tokens'],
};
export default config;
