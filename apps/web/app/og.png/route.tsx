import { colorLight as color, space, typography } from '@clickco/design-tokens';
import { ImageResponse } from 'next/og';
import { LAUNCH_CITIES } from '../../src/content/cities';
import { SITE } from '../../src/content/site';
import { brandMarkSvg } from '../../src/lib/brand-mark';
import { OG_IMAGE } from '../../src/lib/metadata';

// Static export: written once to out/og.png, the default Open Graph / Twitter image.
export const dynamic = 'force-static';

const cityNames = LAUNCH_CITIES.map((city) => city.name);
const headline = `Professional photographers in ${cityNames.slice(0, -1).join(', ')} & ${cityNames.at(-1)}`;
// The bundled OG font is Latin-only, so this image avoids the ₹ sign.
const FACTS = ['Photos in 48 hours', 'Verified photographers', 'GST shown up front'];
const MARK = space[14];
const PAD = space[14] + space[6];

export function GET(): ImageResponse {
  const mark = `data:image/svg+xml;utf8,${encodeURIComponent(brandMarkSvg(MARK))}`;
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: PAD,
        background: color.surface.base,
        color: color.text.primary,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: space[4] }}>
        {/* biome-ignore lint/performance/noImgElement: rendered to PNG by next/og */}
        <img src={mark} width={MARK} height={MARK} alt="" />
        <div style={{ fontSize: typography.scale.display.size * 1.5 }}>{SITE.name}</div>
      </div>
      <div
        style={{
          display: 'flex',
          fontSize: typography.scale.display.size * 2,
          lineHeight: 1.15,
          maxWidth: OG_IMAGE.width - PAD * 2,
        }}
      >
        {headline}
      </div>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: space[8],
          fontSize: typography.scale.h1.size,
          color: color.text.secondary,
          borderTop: `1px solid ${color.border.strong}`,
          paddingTop: space[6],
        }}
      >
        {FACTS.map((fact) => (
          <div key={fact} style={{ display: 'flex' }}>
            {fact}
          </div>
        ))}
      </div>
    </div>,
    { width: OG_IMAGE.width, height: OG_IMAGE.height },
  );
}
