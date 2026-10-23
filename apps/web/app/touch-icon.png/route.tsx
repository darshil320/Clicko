import { ImageResponse } from 'next/og';
import { brandMarkSvg } from '../../src/lib/brand-mark';

// Static export: written once to out/touch-icon.png (apple-touch-icon and JSON-LD logo).
export const dynamic = 'force-static';

const SIZE = 180;

export function GET(): ImageResponse {
  const src = `data:image/svg+xml;utf8,${encodeURIComponent(brandMarkSvg(SIZE))}`;
  return new ImageResponse(
    // biome-ignore lint/performance/noImgElement: rendered to PNG by next/og, not shipped as HTML
    <img src={src} width={SIZE} height={SIZE} alt="" />,
    { width: SIZE, height: SIZE },
  );
}
