import {
  bp,
  fluidType,
  fontDisplay,
  fx,
  hairline,
  ICON,
  L,
  measure,
  micro,
  motionOk,
  mq,
  px,
  R,
  rhythm,
  S,
  shadow,
  stroke,
  T,
  tint,
  type,
  v,
  webType,
} from './tokens';

/** Viewfinder corner brackets drawn with gradients — no image, no extra elements. */
function viewfinderCorners(colour: string): string {
  const arm = px(S[6]);
  const w = px(stroke.thick);
  const line = `linear-gradient(${v(colour)},${v(colour)})`;
  const corners = ['left top', 'right top', 'left bottom', 'right bottom'];
  return corners
    .flatMap((at) => [`${line} ${at}/${arm} ${w} no-repeat`, `${line} ${at}/${w} ${arm} no-repeat`])
    .join(',');
}

/** Dot grid that fades out from the top centre (Magic UI dot-pattern, rebuilt in token CSS). */
export function dotGrid(at = '50% 0%'): string {
  const dot = `radial-gradient(${v('border-strong')} ${px(fx.dotRadius)},transparent ${px(fx.dotRadius + stroke.hairline)})`;
  const fade = `radial-gradient(ellipse at ${at},${v('text-primary')},transparent ${fx.dotFade}%)`;
  return `background-image:${dot};background-size:${px(fx.dotGap)} ${px(fx.dotGap)};
  -webkit-mask-image:${fade};mask-image:${fade}`;
}

/** A soft amber glow, centred behind a headline. */
export function amberGlow(): string {
  return `width:${px(fx.glowSize)};max-width:100%;aspect-ratio:${fx.glowAspect}/1;left:50%;transform:translateX(-50%);
  background:radial-gradient(closest-side,${tint('accent-default', fx.glowPercent)},transparent);
  filter:blur(${px(fx.glowBlur)})`;
}

/** Home hero, quote stage, floating activity cards and the city marquee. */
export function heroCss(): string {
  return [heroFrameCss(), stageCss(), marqueeCss()].join('\n');
}

function heroFrameCss(): string {
  return `
.hero{position:relative;overflow:hidden;isolation:isolate;padding-top:${px(rhythm.mobile)};
  padding-bottom:${px(rhythm.mobile)}}
.hero::before{content:"";position:absolute;inset:0;z-index:-2;${dotGrid()}}
.page-hero::before{content:"";position:absolute;inset:0;z-index:-1;${dotGrid('100% 0%')}}
.hero::after{content:"";position:absolute;top:${px(-S[14])};z-index:-1;pointer-events:none;${amberGlow()}}
.hero-copy{max-width:${px(measure.hero)};margin-left:auto;margin-right:auto;text-align:center}
.hero h1{${fluidType(webType.hero)};margin:${px(S[6])} 0 ${px(S[5])}}
.hero h1 .soft{color:${v('text-tertiary')}}
.hero .lead{max-width:${px(measure.prose)};margin-left:auto;margin-right:auto}
.hero .actions{justify-content:center}
.facts{display:flex;flex-wrap:wrap;justify-content:center;gap:${px(S[3])} ${px(S[8])};list-style:none;
  margin:${px(S[8])} 0 0;padding:0;color:${v('text-secondary')};${type(T.caption)}}
.facts li{display:inline-flex;align-items:center;gap:${px(S[2])}}
.facts svg{width:${px(S[4])};height:${px(S[4])};color:${v('success')}}
.facts a{display:inline-flex;align-items:center;min-height:${px(L.minTapTarget)}}
.facts strong{color:${v('text-primary')};font-weight:${T.bodyStrong.weight};font-variant-numeric:tabular-nums}
${mq(bp.sm)}{.hero{padding-top:${px(rhythm.tablet)}}}
${mq(bp.lg)}{
  .hero{padding-top:${px(rhythm.desktop)};padding-bottom:${px(rhythm.tablet)}}
  .hero h1 .soft{display:block}
}
`;
}

function stageCss(): string {
  return `
.hero-stage{position:relative;display:grid;justify-items:center;margin-top:${px(S[14])}}
.viewfinder{position:relative;width:100%;max-width:${px(measure.stage)};margin:0;padding:${px(S[8])} ${px(S[6])};
  background:${viewfinderCorners('border-strong')}}
.viewfinder-label{${micro};color:${v('text-secondary')};display:flex;justify-content:space-between;
  margin:0 0 ${px(S[3])}}
.quote{background:${v('surface-base')};border:${hairline()};border-radius:${px(R.lg)};padding:${px(S[6])};
  box-shadow:${shadow('lg')};text-align:left}
.quote h2{${micro};color:${v('text-secondary')};font-family:inherit;margin:0 0 ${px(S[4])}}
.quote dl{margin:0;display:grid;gap:0}
.quote-row{display:flex;justify-content:space-between;gap:${px(S[4])};padding:${px(S[3])} 0;border-bottom:${hairline()};
  font-variant-numeric:tabular-nums}
.quote-row dt{color:${v('text-secondary')}}
.quote-row dd{margin:0;text-align:right}
.quote-sum{border-bottom:0;padding-top:${px(S[4])}}
.quote-sum dt{color:${v('text-primary')};${type(T.bodyStrong)};align-self:end}
.quote-sum dd{font-family:${fontDisplay};${fluidType(webType.figure)}}
.quote-meta{margin:${px(S[4])} 0 0;padding-top:${px(S[4])};border-top:${hairline()};color:${v('text-secondary')};
  ${type(T.caption)}}
.float{display:none}
${mq(bp.lg)}{
  .hero-stage{margin-top:${px(rhythm.tablet)}}
  .float{position:absolute;display:flex;align-items:center;gap:${px(S[3])};padding:${px(S[3])} ${px(S[4])}
    ${px(S[3])} ${px(S[3])};background:${v('surface-base')};border:${hairline()};border-radius:${px(R.lg)};
    box-shadow:${shadow('md')};text-align:left;${type(T.caption)};color:${v('text-secondary')}}
  .float strong{display:block;${type(T.bodyStrong)};color:${v('text-primary')}}
  .float .icon-chip{margin:0}
  .float-start{left:0;top:${px(S[14] + S[10])}}
  .float-end{right:0;bottom:${px(S[14])}}
}
`;
}

function marqueeCss(): string {
  const edge = `linear-gradient(to right,transparent,${v('text-primary')} ${fx.marqueeFade}%,${v('text-primary')} ${100 - fx.marqueeFade}%,transparent)`;
  return `
.marquee-band{padding:${px(S[8])} 0;border-top:${hairline()};border-bottom:${hairline()}}
.marquee-label{${micro};color:${v('text-secondary')};text-align:center;margin:0 0 ${px(S[5])}}
.marquee{position:relative;overflow:hidden}
.marquee-track{display:flex;justify-content:center}
.marquee-list{display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:${px(S[3])} ${px(S[10])};
  margin:0;padding:0;list-style:none}
.marquee-list[aria-hidden="true"]{display:none}
.marquee-item{display:inline-flex;align-items:center;gap:${px(S[2])};white-space:nowrap;font-family:${fontDisplay};
  ${fluidType(webType.title)};color:${v('text-secondary')}}
.marquee-item svg{width:${px(ICON.size)};height:${px(ICON.size)};color:${v('text-tertiary')}}
.marquee-city{color:${v('text-primary')}}
${motionOk}{
  .marquee{-webkit-mask-image:${edge};mask-image:${edge}}
  .marquee-track{width:max-content;justify-content:flex-start}
  .marquee-list{flex-wrap:nowrap;padding-right:${px(S[10])}}
  .marquee-list[aria-hidden="true"]{display:flex}
}
`;
}
