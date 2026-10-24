import { daylightGlow } from './layout';
import {
  bp,
  collage,
  fluidType,
  fontDisplay,
  hairline,
  headerOverlay,
  ICON,
  L,
  label,
  measure,
  motionOk,
  mq,
  px,
  R,
  rhythm,
  S,
  shadow,
  T,
  type,
  v,
  webType,
} from './tokens';

/** Home hero: editorial copy on the left, the photo collage with the sample quote on the right. */
export function heroCss(): string {
  return [heroFrameCss(), stageCss(), marqueeCss()].join('\n');
}

function heroFrameCss(): string {
  return `
.hero{position:relative;overflow:hidden;isolation:isolate;padding-top:${px(S[8])};padding-bottom:${px(rhythm.mobile)}}
.hero::before{content:"";position:absolute;inset:0;z-index:-1;pointer-events:none;${daylightGlow()}}
.hero-grid{display:grid;gap:${px(S[14])};align-items:center}
.hero-copy{max-width:${px(measure.hero)}}
.hero h1{${fluidType(webType.hero)};margin:${px(S[6])} 0}
.hero h1 em{display:inline}
.hero .lead{max-width:${px(measure.prose)}}
.facts{display:grid;gap:${px(S[3])};list-style:none;margin:${px(S[10])} 0 0;padding:${px(S[6])} 0 0;
  border-top:${hairline()};color:${v('text-secondary')};${type(T.caption)}}
.facts li{display:flex;align-items:center;gap:${px(S[2])}}
.facts svg{width:${px(S[4])};height:${px(S[4])};color:${v('sage-deep')};flex-shrink:0}
.facts a{display:inline-flex;align-items:center;min-height:${px(L.minTapTarget)}}
.facts strong{color:${v('text-primary')};font-weight:${T.bodyStrong.weight};font-variant-numeric:tabular-nums}
${mq(bp.sm)}{.hero{padding-top:${px(S[14])}}.facts{display:flex;flex-wrap:wrap;gap:${px(S[3])} ${px(S[8])}}}
${mq(bp.lg)}{
  .hero{padding-top:${px(S[14] + S[10] + headerOverlay)};padding-bottom:${px(rhythm.tablet)}}
  .hero-grid{grid-template-columns:minmax(0,11fr) minmax(0,10fr);gap:${px(S[14])}}
}
`;
}

const box = (b: Readonly<Record<string, number>>): string =>
  Object.entries(b)
    .map(([side, value]) => `${side}:${value}%`)
    .join(';');

function stageCss(): string {
  return `
.hero-stage{position:relative;display:grid;justify-items:center}
.collage-main{width:100%;max-width:${px(collage.phoneMax)}}
.collage-side{display:none}
.collage-quote{position:relative;z-index:2;width:100%;max-width:${px(collage.phoneMax - S[10])};
  margin-top:${px(-collage.quoteOverlap)}}
.quote{background:${v('surface-overlay')};border:${hairline()};border-radius:${px(R.lg)};padding:${px(S[5])};
  box-shadow:${shadow('lg')};text-align:left}
.quote h2{display:flex;justify-content:space-between;gap:${px(S[2])};${type(T.bodyStrong)};font-family:inherit;
  color:${v('text-primary')};margin:0 0 ${px(S[3])}}
.quote h2 span{${label};color:${v('text-tertiary')}}
.quote dl{margin:0;display:grid;gap:0}
.quote-row{display:flex;justify-content:space-between;gap:${px(S[4])};padding:${px(S[2])} 0;
  font-variant-numeric:tabular-nums;${type(T.caption)}}
.quote-row dt{color:${v('text-secondary')}}
.quote-row dd{margin:0;text-align:right}
.quote-sum{margin-top:${px(S[2])};padding-top:${px(S[3])};border-top:${hairline('border-strong')};border-top-style:dashed;
  align-items:baseline}
.quote-sum dt{color:${v('text-primary')};${type(T.bodyStrong)}}
.quote-sum dd{font-family:${fontDisplay};${fluidType(webType.figure)}}
.quote-meta{margin:${px(S[3])} 0 0;color:${v('text-tertiary')};${type(T.caption)}}
.float{display:none}
${mq(bp.lg)}{
  .hero-stage{display:block;height:${px(collage.height)}}
  .hero-stage .photo{position:absolute;box-shadow:${shadow('photo')};max-width:none}
  .collage-main{${box(collage.main)}}
  .collage-side{display:block}
  .collage-top{${box(collage.sideTop)}}
  .collage-bottom{${box(collage.sideBottom)}}
  .collage-quote{position:absolute;left:${px(-S[8])};bottom:0;width:${px(measure.stage / 2 + S[14])};margin:0}
  .float{position:absolute;z-index:3;display:flex;align-items:center;gap:${px(S[3])};
    padding:${px(S[3])} ${px(S[4])} ${px(S[3])} ${px(S[3])};background:${v('surface-overlay')};border:${hairline()};
    border-radius:${px(R.lg)};box-shadow:${shadow('lg')};text-align:left;${type(T.caption)};color:${v('text-secondary')}}
  .float strong{display:block;${type(T.bodyStrong)};color:${v('text-primary')}}
  .float .icon-chip{margin:0}
  .float-start{left:${px(-S[10])};top:${px(S[14])}}
  .float-end{right:${px(-S[4])};bottom:${px(S[4])}}
}
`;
}

function marqueeCss(): string {
  return `
.marquee-band{padding:${px(S[6])} 0;border-top:${hairline()};border-bottom:${hairline()}}
.marquee-label{${label};color:${v('text-tertiary')};text-align:center;margin:0 0 ${px(S[4])}}
.marquee{position:relative;overflow:hidden}
.marquee-track{display:flex;justify-content:center}
.marquee-list{display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:${px(S[3])} ${px(S[10])};
  margin:0;padding:0;list-style:none}
.marquee-list[aria-hidden="true"]{display:none}
.marquee-item{display:inline-flex;align-items:center;gap:${px(S[3])};white-space:nowrap;font-family:${fontDisplay};
  ${fluidType(webType.figure)};color:${v('text-primary')}}
.marquee-item:nth-child(even){font-style:italic;color:${v('accent-text')}}
.marquee-item svg{width:${px(ICON.size)};height:${px(ICON.size)};color:${v('text-tertiary')}}
.marquee-city{color:${v('text-secondary')}}
${motionOk}{
  .marquee{-webkit-mask-image:${fade()};mask-image:${fade()}}
  .marquee-track{width:max-content;justify-content:flex-start}
  .marquee-list{flex-wrap:nowrap;padding-right:${px(S[10])}}
  .marquee-list[aria-hidden="true"]{display:flex}
}
`;
}

const fade = (): string =>
  `linear-gradient(to right,transparent,${v('text-primary')} 10%,${v('text-primary')} 90%,transparent)`;
