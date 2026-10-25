import { px, R, RD, S, stroke, T, tint, type, v } from './tokens';

/**
 * Placeholder moods for photo frames (DESIGN-DAYLIGHT §Imagery): soft, photographic light painted
 * only from the photo/* tokens, so each frame reads like a real image until one replaces it.
 * Keys are the PhotoMood values in components/ui/PhotoFrame.tsx.
 */
const glow = (w: number, h: number, at: string, colour: string, fade = 72): string =>
  `radial-gradient(${w}% ${h}% at ${at},${colour} 0,transparent ${fade}%)`;
const spark = (w: number, at: string, percent: number): string =>
  `radial-gradient(${w}% ${w}% at ${at},${tint('surface-overlay', percent)} 0,transparent 100%)`;
const wash = (deg: number, ...stops: string[]): string =>
  `linear-gradient(${deg}deg,${stops.join(',')})`;
const p = (name: string): string => v(`photo-${name}`);

export const MOODS: Readonly<Record<string, readonly string[]>> = {
  /** Weddings, people at golden hour: warm sun, rose skin tones, bokeh. */
  golden: [
    spark(5, '22% 30%', 70),
    spark(4, '34% 18%', 55),
    spark(7, '84% 48%', 45),
    glow(18, 14, '72% 22%', p('cream'), 100),
    glow(60, 50, '72% 22%', p('sun')),
    glow(70, 60, '20% 90%', p('ember')),
    glow(40, 35, '35% 45%', p('rose'), 80),
    wash(160, p('cream'), `${p('rose')} 55%`, p('ember')),
  ],
  /** Food: a bright plate on a dark table. */
  plate: [
    glow(6, 5, '46% 48%', p('leaf'), 100),
    glow(5, 4, '58% 58%', p('sun'), 100),
    glow(34, 30, '52% 54%', p('ember'), 75),
    glow(48, 42, '52% 54%', p('cream')),
    glow(70, 60, '50% 50%', p('dusk'), 100),
    wash(135, p('dusk'), v('darkroom-default')),
  ],
  /** Portraits outdoors: leaves, dappled light, a figure in rose. */
  garden: [
    spark(4, '70% 22%', 70),
    spark(6, '82% 34%', 45),
    glow(14, 20, '42% 58%', p('rose'), 100),
    glow(50, 45, '30% 25%', p('cream'), 75),
    glow(60, 60, '80% 80%', p('leaf'), 70),
    glow(35, 30, '65% 35%', p('sun'), 80),
    wash(200, p('cream'), p('leaf')),
  ],
  /** Products: one object on a studio sweep. */
  studio: [
    glow(16, 5, '50% 72%', tint('photo-dusk', 35), 100),
    glow(11, 22, '50% 52%', p('ember'), 62),
    glow(40, 32, '50% 58%', p('sun'), 75),
    glow(90, 60, '50% 120%', p('rose'), 70),
    wash(180, `${p('cream')} 40%`, p('rose')),
  ],
  /** Events: lights in a dark room. */
  night: [
    glow(18, 14, '30% 35%', p('sun'), 80),
    glow(14, 12, '68% 28%', p('ember'), 80),
    glow(22, 18, '78% 62%', p('sun'), 80),
    glow(60, 50, '40% 100%', p('ember'), 75),
    wash(180, p('dusk'), v('darkroom-default')),
  ],
  /** Real estate: daylight, a horizon through a window. */
  coast: [
    glow(14, 10, '70% 30%', p('cream'), 100),
    `linear-gradient(180deg,transparent 57%,${tint('surface-overlay', 55)} 57.4%,transparent 59%)`,
    `linear-gradient(180deg,transparent 57.5%,${p('sea')} 58%,transparent 100%)`,
    glow(55, 40, '50% 10%', p('cream'), 75),
    glow(70, 55, '85% 95%', p('sea'), 70),
    glow(30, 25, '25% 70%', p('rose'), 80),
    wash(180, p('cream'), p('sea')),
  ],
  /** Corporate: cool window light on a desk. */
  office: [
    `linear-gradient(90deg,transparent 62%,${tint('surface-overlay', 45)} 62.5%,transparent 66%)`,
    glow(40, 60, '80% 30%', p('cream'), 80),
    glow(30, 20, '30% 75%', p('rose'), 80),
    glow(70, 50, '20% 20%', p('sea'), 70),
    wash(160, p('sea'), p('cream'), p('dusk')),
  ],
};

/** Fine film grain, so flat gradients read as photographs. */
const GRAIN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

const GRAIN_OPACITY = 0.22;
const PLATE_PERCENT = 72;
const PLATE_BLUR = S[3];

/** Photo frames, their caption plates and the inline headline pill. */
export function photoCss(): string {
  const moods = Object.entries(MOODS)
    .map(([mood, layers]) => `.mood-${mood}::before{background:${layers.join(',')}}`)
    .join('\n');
  return `
.photo{position:relative;overflow:hidden;isolation:isolate;margin:0;border-radius:${px(RD.photo)};
  background:${p('cream')};aspect-ratio:4/5}
.photo::before,.photo::after{content:"";position:absolute;inset:0;pointer-events:none}
.photo::before{z-index:-1}
.photo::after{opacity:${GRAIN_OPACITY};mix-blend-mode:soft-light;background-image:${GRAIN}}
.photo img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:-1}
.photo-real::after{content:none}
.photo-wide{aspect-ratio:16/10}
.photo-square{aspect-ratio:1}
.photo-fill{position:absolute;inset:0;aspect-ratio:auto;border-radius:0}
.photo-cap{position:absolute;z-index:1;left:${px(S[4])};bottom:${px(S[4])};max-width:calc(100% - ${px(S[8])});
  padding:${px(S[1] + stroke.hairline)} ${px(S[2] + stroke.thick)};border-radius:${px(R.sm)};
  background:${tint('surface-overlay', PLATE_PERCENT)};-webkit-backdrop-filter:blur(${px(PLATE_BLUR)});
  backdrop-filter:blur(${px(PLATE_BLUR)});${type(T.caption)};font-weight:${T.bodyStrong.weight};color:${p('dusk')};
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
${moods}
`;
}
