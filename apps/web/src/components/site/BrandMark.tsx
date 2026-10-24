import { space } from '@clickco/design-tokens';

const SIZE = space[8];

/** The Clickco lens mark, served as the token-built /favicon.svg (app/favicon.svg/route.ts). */
export function BrandMark() {
  return (
    // biome-ignore lint/performance/noImgElement: static export has no image optimiser (next.config output: 'export')
    <img src="/favicon.svg" alt="" width={SIZE} height={SIZE} />
  );
}
