import { brandMarkSvg } from '../../src/lib/brand-mark';

// Static export: written once to out/favicon.svg, built from design tokens.
export const dynamic = 'force-static';

export function GET(): Response {
  return new Response(brandMarkSvg(), {
    headers: { 'Content-Type': 'image/svg+xml; charset=utf-8' },
  });
}
