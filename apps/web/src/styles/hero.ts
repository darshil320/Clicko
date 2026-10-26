import {
  bp,
  cq,
  fluidType,
  fontDisplay,
  hairline,
  headerOverlay,
  ICON,
  L,
  measure,
  mq,
  picker,
  px,
  R,
  rhythm,
  S,
  shadow,
  stroke,
  T,
  type,
  v,
  webType,
} from './tokens';

/**
 * Home hero (ADR-0019): the headline across the page, then the shoot picker beside a sample
 * photo of the chosen category. Flat paper, no glow: the picker and the photo carry the page.
 */
export function heroCss(): string {
  return [heroFrameCss(), pickerCss(), visualCss(), shootBarCss()].join('\n');
}

/** The hero frame, headline and fact list (the 404 page shares them). */
function heroFrameCss(): string {
  return `
.hero{position:relative;padding-top:${px(S[8])};padding-bottom:${px(rhythm.mobile)}}
.hero-grid{display:grid;gap:${px(S[8])};grid-template-columns:minmax(0,1fr)}
.hero-head{max-width:${px(measure.hero)}}
.hero-kicker{${type(T.caption)};font-weight:${T.bodyStrong.weight};color:${v('text-secondary')};margin:0 0 ${px(S[4])}}
.hero h1{${fluidType(webType.page)};margin:0}
.hero-copy{max-width:${px(measure.hero)}}
.hero-copy h1{margin:${px(S[6])} 0}
.hero .lead{max-width:${px(measure.prose)}}
.facts{display:grid;gap:${px(S[3])};list-style:none;margin:${px(S[10])} 0 0;padding:${px(S[6])} 0 0;
  border-top:${hairline()};color:${v('text-secondary')};${type(T.caption)}}
.facts li{display:flex;align-items:center;gap:${px(S[2])}}
.facts svg{width:${px(S[4])};height:${px(S[4])};color:${v('sage-deep')};flex-shrink:0}
.facts a{display:inline-flex;align-items:center;min-height:${px(L.minTapTarget)}}
.facts strong{color:${v('text-primary')};font-weight:${T.bodyStrong.weight};font-variant-numeric:tabular-nums}
${mq(bp.sm)}{.hero{padding-top:${px(S[14])}}.facts{display:flex;flex-wrap:wrap;gap:${px(S[3])} ${px(S[8])}}}
${mq(bp.lg)}{
  .hero{padding-top:${px(S[10] + headerOverlay)};padding-bottom:${px(rhythm.tablet)}}
  .hero-grid{grid-template-columns:minmax(0,7fr) minmax(0,5fr);column-gap:${px(S[10])};row-gap:${px(S[10])};
    align-items:stretch}
  .hero-head{grid-column:1/-1;max-width:none}
}
`;
}

/** A visually hidden radio over its whole label: the label is the control (tiles, segments). */
const coverInput = `position:absolute;inset:0;width:100%;height:100%;margin:0;opacity:0;cursor:pointer`;
const ring = `outline:${px(stroke.thick)} solid ${v('text-primary')};outline-offset:${px(stroke.thick)}`;

function pickerCss(): string {
  return `
.picker{container-type:inline-size;min-width:0;margin:0;background:${v('surface-overlay')};border:${hairline()};
  border-radius:${px(R.lg)};padding:${px(S[4])};box-shadow:${shadow('md')}}
.picker-controls{min-width:0;margin:0;padding:0;border:0}
.picker-title{${type(T.bodyStrong)};margin:0 0 ${px(S[3])}}
.cat-tiles{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:${px(S[2])}}
.cat-tile{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;
  gap:${px(S[2])};min-height:${px(picker.tileHeight)};padding:${px(S[3])} ${px(S[1])};border-radius:${px(R.md)};
  border:${px(stroke.hairline)} solid transparent;background:${v('surface-raised')};${type(T.caption)};
  font-weight:${T.bodyStrong.weight};color:${v('text-secondary')};text-align:center;cursor:pointer}
.cat-tile input{${coverInput}}
.cat-tile svg{width:${px(ICON.size)};height:${px(ICON.size)};color:${v('text-primary')}}
.cat-tile:hover{border-color:${v('border-strong')};color:${v('text-primary')}}
.cat-tile:has(:checked){background:${v('text-primary')};color:${v('surface-overlay')}}
.cat-tile:has(:checked) svg{color:${v('surface-overlay')}}
.cat-tile:has(:focus-visible){${ring}}
.picker-rows{margin-top:${px(S[5])};border-top:${hairline()}}
.picker-row{display:grid;gap:${px(S[2])};align-items:center;padding:${px(S[3])} 0;border-bottom:${hairline()}}
.picker-label{${type(T.caption)};color:${v('text-secondary')};margin:0}
.picker-total{display:grid;gap:${px(S[4])};margin-top:${px(S[5])}}
.picker-total p{margin:0}
.picker-price{font-family:${fontDisplay};${fluidType(webType.figure)};color:${v('text-primary')}}
.picker-price-text{${type(T.h1)}}
.picker-price.num{font-variant-numeric:proportional-nums}
.picker-controls>.picker-row:first-child{padding-top:0;margin-bottom:${px(S[4])}}
.picker-break{${type(T.caption)};color:${v('text-secondary')};margin-top:${px(S[1])}}
.picker-cta{display:grid;gap:${px(S[1])}}
.picker-cta .text-link{justify-self:center;${type(T.caption)};font-weight:${T.bodyStrong.weight}}
.picker-cta .text-link svg{width:${px(S[4])};height:${px(S[4])}}
.picker-note{margin:${px(S[4])} 0 0;${type(T.caption)};color:${v('text-tertiary')}}
.seg-opt input{${coverInput}}
.seg-opt:has(:focus-visible)>span{${ring}}
${cq(picker.rowsInline)}{
  .picker-row{grid-template-columns:${px(picker.labelColumn)} minmax(0,1fr);gap:${px(S[4])}}
  .picker-row .stepper{justify-self:start}
  .picker .seg-wide{grid-auto-flow:column;grid-template-columns:none;border-radius:${px(R.full)}}
  .picker .seg-wide .seg-opt>span{border-radius:${px(R.full)}}
  .picker-total{grid-template-columns:minmax(0,1fr) auto;align-items:end}
  .picker-cta .text-link{justify-self:end}
}
${cq(picker.tilesInRow)}{.cat-tiles{grid-template-columns:repeat(7,minmax(0,1fr))}}
${mq(bp.lg)}{.picker{padding:${px(S[6])}}}
`;
}

/** Phones: the chosen shoot and its price in a bar at the bottom once the picker is gone (ADR-0023). */
function shootBarCss(): string {
  return `
.shoot-bar{position:fixed;z-index:20;left:${px(S[2])};right:${px(S[2])};
  bottom:calc(${px(S[2])} + env(safe-area-inset-bottom));display:flex;align-items:center;gap:${px(S[3])};
  padding:${px(S[2])} ${px(S[2])} ${px(S[2])} ${px(S[4])};background:${v('surface-overlay')};border:${hairline()};
  border-radius:${px(R.lg)};box-shadow:${shadow('lg')};opacity:0;translate:0 calc(100% + ${px(S[4])});
  pointer-events:none}
.shoot-bar[data-visible="true"]{opacity:1;translate:none;pointer-events:auto}
.shoot-bar-summary{flex:1;min-width:0;display:grid;color:${v('text-primary')};text-decoration:none}
.shoot-bar-what{${type(T.caption)};color:${v('text-secondary')};white-space:nowrap;overflow:hidden;
  text-overflow:ellipsis}
.shoot-bar-price{display:flex;align-items:baseline;gap:${px(S[2])};${type(T.bodyStrong)}}
.shoot-bar-extra{${type(T.caption)};color:${v('text-secondary')};font-weight:${T.body.weight}}
.shoot-bar-edit{${type(T.caption)};color:${v('accent-text')};text-decoration:underline}
html{scroll-padding-bottom:${px(S[14] + S[8])}}
${mq(bp.lg)}{.shoot-bar{display:none}html{scroll-padding-bottom:0}}
`;
}

function visualCss(): string {
  return `
.hero-visual{display:flex;flex-direction:column;gap:${px(S[5])};min-width:0}
.hero-photo{width:100%;aspect-ratio:4/3}
.hero-photo img{object-position:50% 35%}
.hero-visual .reel.hero-photo{aspect-ratio:4/5}
.facts.hero-facts{display:grid;gap:${px(S[2])};margin:0;padding:0;border:0}
${mq(bp.lg)}{
  .hero-photo{flex:1 1 auto;aspect-ratio:auto;min-height:${px(picker.photoMin)}}
  .hero-visual .reel.hero-photo{aspect-ratio:9/16;width:auto;max-width:100%;align-self:center}
}
`;
}
