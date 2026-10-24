import {
  bandWhenColumn,
  bp,
  cardPhotoHeight,
  fluidType,
  fontDisplay,
  hairline,
  ICON,
  L,
  label,
  measure,
  mq,
  px,
  R,
  RD,
  rhythm,
  S,
  shadow,
  stroke,
  T,
  type,
  v,
  webType,
} from './tokens';

const TIER_TONES = ['tertiary', 'secondary', 'primary'] as const;

/** Photo cards, steps, trust tiles, tier cards, lead-time table, city cards, CTA panel. */
export function sectionsCss(): string {
  return [
    photoCardsCss(),
    stepsCss(),
    bentoCss(),
    tiersCss(),
    bandsCss(),
    cardsExtraCss(),
    panelCss(),
  ].join('\n');
}

/** A card that opens with a photograph: categories, steps and cities. */
function photoCardsCss(): string {
  return `
.card-photo{padding:${px(S[3])};overflow:hidden}
.card-photo>.photo{height:${px(cardPhotoHeight)};aspect-ratio:auto;border-radius:${px(R.lg)}}
.card-photo .card-body{display:flex;flex-direction:column;flex:1;padding:${px(S[5])} ${px(S[3])} ${px(S[3])}}
.card-photo .card-body>:last-child{margin-bottom:0}
.card-photo h3{font-family:${fontDisplay};${fluidType(webType.figure)};margin-bottom:${px(S[2])}}
.card-photo .card-arrow{top:auto;bottom:${px(S[5])};right:${px(S[5])};display:grid;place-items:center;
  width:${px(S[8] + S[1])};height:${px(S[8] + S[1])};border-radius:${px(R.full)};background:${v('text-primary')};
  color:${v('surface-overlay')}}
.lift.card-photo:hover .card-arrow{color:${v('surface-overlay')}}
.card-photo .photo .badge{position:absolute;z-index:1;top:${px(S[3])};left:${px(S[3])};margin:0}
`;
}

function stepsCss(): string {
  return `
.steps{display:grid;gap:${px(S[4])};list-style:none;margin:0;padding:0}
.step{position:relative}
.step-num{position:absolute;z-index:2;top:${px(S[6])};left:${px(S[6])};display:grid;place-items:center;
  width:${px(S[10] + S[1])};height:${px(S[10] + S[1])};border-radius:${px(R.full)};background:${v('surface-overlay')};
  font-family:${fontDisplay};${type(T.h1)};font-weight:${webType.figure.weight};color:${v('text-primary')};
  box-shadow:${shadow('md')};font-variant-numeric:tabular-nums}
.step h3{${fluidType(webType.title)};font-family:inherit}
.step p{margin:0}
.step .badge{margin:${px(S[4])} 0 0}
${mq(bp.sm)}{.steps{grid-template-columns:repeat(2,minmax(0,1fr))}}
${mq(bp.lg)}{.steps{grid-template-columns:repeat(4,minmax(0,1fr))}}
`;
}

/** Trust promises as tinted tiles; the first and last run wide. */
function bentoCss(): string {
  return `
.bento{display:grid;gap:${px(S[4])};grid-template-columns:minmax(0,1fr);list-style:none;margin:0;padding:0}
.tile{overflow:hidden;isolation:isolate;border-radius:${px(RD.photo)}}
.tile h3{font-family:${fontDisplay};${fluidType(webType.figure)};font-weight:${webType.figure.weight}}
.tile p.muted{max-width:${px(measure.prose / 2 + S[14])}}
.tile .chip{background:${v('surface-overlay')};border-color:transparent}
${mq(bp.sm)}{
  .bento{grid-template-columns:repeat(2,minmax(0,1fr))}
  .tile-wide{grid-column:span 2}
}
${mq(bp.lg)}{
  .bento{grid-template-columns:repeat(3,minmax(0,1fr))}
  .tile{min-height:${px(S[14] * 5)};padding:${px(S[8])}}
  .tile .icon-chip{margin-bottom:${px(S[10])}}
}
${mq(bp.sm)}{.grid-feature>:nth-child(5){grid-column:span 2}}
`;
}

function tiersCss(): string {
  const dots = TIER_TONES.map(
    (tone) => `.tone-${tone} .tier-dot{background:${v(`text-${tone}`)}}`,
  ).join('');
  return `
.tier-name{display:flex;align-items:center;gap:${px(S[2])};${label};color:${v('text-secondary')};
  margin:0 0 ${px(S[5])}}
.tier-dot{width:${px(S[2])};height:${px(S[2])};border-radius:${px(R.full)};background:${v('border-strong')}}
${dots}
.tone-accent .tier-dot{background:${v('accent-default')};box-shadow:0 0 0 ${px(S[1] - stroke.hairline)}
  ${v('surface-overlay')}}
.tone-strong .tier-dot{background:${v('text-primary')}}
.tier.tone-accent{background:${v('accent-subtle')};border-color:${v('accent-default')};
  box-shadow:0 0 0 ${px(stroke.hairline)} ${v('accent-default')},${shadow('md')}}
.price-line{font-family:${fontDisplay};${fluidType(webType.figure)};font-variant-numeric:tabular-nums;margin:0;
  padding-top:${px(S[4])};border-top:${hairline()}}
.price-line small{${type(T.caption)};letter-spacing:0;color:${v('text-tertiary')};font-family:inherit}
.tier .price-note{padding-bottom:${px(S[4])};border-bottom:${hairline()}}
.tier .checklist{margin-top:${px(S[2])}}
.tier-signature{grid-column:1/-1;background:${v('text-primary')};border-color:${v('text-primary')}}
.tier-signature,.tier-signature .price-line{color:${v('surface-overlay')}}
.tier-signature .tier-name,.tier-signature .muted,.tier-signature .price-note,.tier-signature .price-line small,
.tier-signature .checklist li{color:${v('border-strong')}}
.tier-signature .tier-dot{background:${v('accent-default')}}
.tier-signature .price-line,.tier-signature .price-note{border-color:${v('text-secondary')}}
.tier-signature .checklist li::before{background:transparent;border-color:${v('text-secondary')}}
.tier-signature .checklist li::after{border-color:${v('accent-default')}}
.tier-signature .text-link{color:${v('surface-overlay')}}
.recommend h3{font-family:${fontDisplay};${fluidType(webType.figure)}}
${mq(bp.lg)}{
  .tier-signature{display:grid;grid-template-columns:minmax(0,5fr) minmax(0,7fr);column-gap:${px(S[14])};
    align-items:start;padding:${px(S[8])}}
  .tier-signature>:not(.checklist){grid-column:1}
  .tier-signature .checklist{grid-column:2;grid-row:1/span 5;margin:0;align-self:center}
}
`;
}

function bandsCss(): string {
  return `
.bands-head{display:none}
.bands-list{display:grid;gap:${px(S[4])};list-style:none;margin:0;padding:0}
.band-row{background:${v('surface-overlay')};border:${hairline()};border-radius:${px(R.lg)};padding:${px(S[5])}}
.band-when{display:flex;flex-wrap:wrap;align-items:center;gap:${px(S[2])} ${px(S[3])};font-family:${fontDisplay};
  ${fluidType(webType.title)};font-weight:${webType.figure.weight};margin:0 0 ${px(S[4])}}
.band-when .badge{margin:0}
.band-row dl{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:${px(S[4])};margin:0}
.band-row dt{${label};color:${v('text-secondary')};margin-bottom:${px(S[1])}}
.band-row dd{margin:0;color:${v('text-primary')}}
${mq(bp.lg)}{
  .bands{border-top:${hairline('border-strong')}}
  .bands-head,.band-row{display:grid;grid-template-columns:${px(bandWhenColumn)} minmax(0,1fr);gap:${px(S[6])}}
  .bands-head{grid-template-columns:${px(bandWhenColumn)} repeat(4,minmax(0,1fr));padding:${px(S[4])} 0;
    border-bottom:${hairline()};${label};color:${v('text-secondary')}}
  .bands-list{gap:0}
  .band-row{background:none;border:0;border-bottom:${hairline()};border-radius:0;padding:${px(S[6])} 0}
  .band-when{flex-direction:column;align-items:flex-start;margin:0}
  .band-row dl{grid-template-columns:repeat(4,minmax(0,1fr));gap:${px(S[6])}}
  .band-row dt{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap}
  .band-row dd{color:${v('text-secondary')}}
  .band-row dd.num{color:${v('text-primary')};font-weight:${T.bodyStrong.weight}}
}
`;
}

function cardsExtraCss(): string {
  return `
.city-card .city-areas{padding-right:${px(S[10] + S[2])}}
.city-areas{display:flex;align-items:center;gap:${px(S[2])};${type(T.caption)};color:${v('text-tertiary')};margin:0}
.city-areas svg{flex-shrink:0;width:${px(S[4])};height:${px(S[4])}}
.factor-list{display:grid;margin:0;padding:0;list-style:none;border-top:${hairline()}}
.factor-list li{display:flex;justify-content:space-between;gap:${px(S[4])};padding:${px(S[4])} 0;
  border-bottom:${hairline()};font-variant-numeric:tabular-nums}
.factor-list li span:last-child{color:${v('text-secondary')};text-align:right}
.split{display:grid;gap:${px(S[10])}}
.split>.card{align-self:start}
.split-gap{margin-top:${px(rhythm.mobile)}}
${mq(bp.lg)}{
  .split{grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:${px(S[14] + S[6])}}
  .split-gap{margin-top:${px(rhythm.tablet)}}
}
.prose-block{max-width:${px(measure.prose)}}
.store-badges{display:flex;flex-wrap:wrap;gap:${px(S[3])};margin:${px(S[8])} 0 0;padding:0;list-style:none}
.store-badge{display:inline-flex;align-items:center;gap:${px(S[3])};min-height:${px(L.buttonHeight + S[2])};
  padding:${px(S[2])} ${px(S[5])} ${px(S[2])} ${px(S[4])};border-radius:${px(R.full)};
  background:${v('text-primary')};color:${v('surface-overlay')};${type(T.bodyStrong)};text-align:left}
.store-badge svg{width:${px(ICON.size + S[1])};height:${px(ICON.size + S[1])}}
.store-badge small{display:block;${label};color:${v('border-strong')}}
`;
}

/** The one amber field per page: the closing call to action, with a tilted print. */
function panelCss(): string {
  return `
.cta-panel{position:relative;overflow:hidden;isolation:isolate;display:grid;gap:${px(S[10])};align-items:center;
  padding:${px(rhythm.mobile)} ${px(S[5])};border-radius:${px(RD.photo)};background:${v('accent-default')};
  color:${v('text-on-accent')}}
.cta-panel .eyebrow,.cta-panel .lead,.cta-panel h2{color:${v('text-on-accent')}}
.cta-panel h2{${fluidType(webType.section)};max-width:${px(measure.prose)};margin:0 0 ${px(S[4])}}
.cta-panel .lead{max-width:${px(measure.prose)};margin:0}
.cta-panel .photo{width:100%;max-width:${px(measure.stage)};justify-self:center;box-shadow:${shadow('photo')}}
${mq(bp.lg)}{
  .cta-panel{grid-template-columns:minmax(0,7fr) minmax(0,5fr);gap:${px(S[14])};
    padding:${px(rhythm.tablet)} ${px(S[14])};border-radius:${px(RD.panel)}}
  .cta-panel .photo{rotate:3deg;justify-self:end}
}
`;
}
