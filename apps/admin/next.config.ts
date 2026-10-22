import type { NextConfig } from 'next';

const config: NextConfig = { transpilePackages: ['@clickco/contracts', '@clickco/utils'] };
export default config;
