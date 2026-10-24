import { amberGlow, dotGrid } from './hero';
import {
  bandWhenColumn,
  bp,
  fluidType,
  fontDisplay,
  hairline,
  ICON,
  L,
  measure,
  micro,
  mq,
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

const TIER_TONES = ['tertiary', 'secondary', 'primary'] as const;

/** Steps, bento, tier cards, lead-time table, city cards, CTA panel. */
export function sectionsCss(): string {
  return [stepsCss(), bentoCss(), tiersCss(), bandsCss(), cardsExtraCss(), panelCss()].join('\n');
}

function stepsCss(): string {
  return `
.steps{display:grid;gap:${px(S[8])};list-style:none;margin:0;padding:0}
.step{position:relative;padding-top:${px(S[6])};border-top:${hairline()}}
.step::before{content:"";position:absolute;left:0;top:${px(-stroke.hairline)};width:${px(S[10])};
  height:${px(stroke.thick)};background:${v('text-primary')}}
.step-num{display:block;margin-bottom:${px(S[5])};font-family:${fontDisplay};${fluidType(webType.figure)};
  color:${v('text-tertiary')};font-variant-numeric:tabular-nums}
.step p{margin:0}
${mq(bp.sm)}{.steps{grid-template-columns:repeat(2,minmax(0,1fr));gap:${px(S[10])} ${px(S[8])}}}
${mq(bp.lg)}{.steps{grid-template-columns:repeat(4,minmax(0,1fr))}}
`;
}

function bentoCss(): string {
  return `
.bento{display:grid;gap:${px(S[4])};grid-template-columns:minmax(0,1fr);list-style:none;margin:0;padding:0}
.tile{overflow:hidden;isolation:isolate}
.tile p.muted{max-width:${px(measure.prose / 2 + S[14])}}
.tile-wide::before{content:"";position:absolute;inset:0;z-index:-1;${dotGrid('100% 0%')}}
${mq(bp.sm)}{
  .bento{grid-template-columns:repeat(2,minmax(0,1fr))}
  .tile-wide{grid-column:span 2}
}
${mq(bp.lg)}{
  .bento{grid-template-columns:repeat(3,minmax(0,1fr));gap:${px(S[6])}}
  .tile{min-height:${px(S[14] * 5)}}
  .tile .icon-chip{margin-bottom:${px(S[8])}}
}
${mq(bp.sm)}{.grid-feature>:nth-child(5){grid-column:span 2}}
`;
}

function tiersCss(): string {
  const dots = TIER_TONES.map(
    (tone) => `.tone-${tone} .tier-dot{background:${v(`text-${tone}`)}}`,
  ).join('');
  return `
.tier-name{display:flex;align-items:center;gap:${px(S[2])};${micro};color:${v('text-secondary')};
  margin:0 0 ${px(S[4])}}
.tier-dot{width:${px(S[2])};height:${px(S[2])};border-radius:${px(R.full)};background:${v('border-strong')}}
${dots}
.tone-accent .tier-dot{background:${v('accent-default')};box-shadow:0 0 0 ${px(S[1] - stroke.hairline)}
  ${v('accent-subtle')}}
.tone-strong .tier-dot{background:${v('border-strong')}}
.tier.tone-accent{background:${v('surface-base')};border-color:${v('border-strong')};box-shadow:${shadow('md')}}
.price-line{font-family:${fontDisplay};${fluidType(webType.figure)};font-variant-numeric:tabular-nums;margin:0}
.price-line small{${type(T.body)};letter-spacing:0;color:${v('text-secondary')};font-family:inherit}
.tier .checklist{margin-top:${px(S[2])}}
.tier-signature{grid-column:1/-1}
.recommend h3{${fluidType(webType.figure)}}
${mq(bp.lg)}{
  .tier-signature{display:grid;grid-template-columns:minmax(0,5fr) minmax(0,7fr);column-gap:${px(S[14])};
    align-items:start}
  .tier-signature>:not(.checklist){grid-column:1}
  .tier-signature .checklist{grid-column:2;grid-row:1/span 5;margin:0;align-self:center}
}
`;
}

function bandsCss(): string {
  return `
.bands-head{display:none}
.bands-list{display:grid;gap:${px(S[4])};list-style:none;margin:0;padding:0}
.band-row{background:${v('surface-raised')};border:${hairline()};border-radius:${px(R.lg)};padding:${px(S[5])}}
.band-when{display:flex;flex-wrap:wrap;align-items:center;gap:${px(S[2])} ${px(S[3])};${type(T.bodyStrong)};
  font-family:inherit;margin:0 0 ${px(S[4])}}
.band-when .badge{margin:0}
.band-row dl{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:${px(S[4])};margin:0}
.band-row dt{${micro};color:${v('text-secondary')};margin-bottom:${px(S[1])}}
.band-row dd{margin:0;color:${v('text-primary')}}
${mq(bp.lg)}{
  .bands{border-top:${hairline('border-strong')}}
  .bands-head,.band-row{display:grid;grid-template-columns:${px(bandWhenColumn)} minmax(0,1fr);gap:${px(S[6])}}
  .bands-head{grid-template-columns:${px(bandWhenColumn)} repeat(4,minmax(0,1fr));padding:${px(S[4])} 0;
    border-bottom:${hairline()};${micro};color:${v('text-secondary')}}
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
.city-card h3{${fluidType(webType.title)};padding-right:${px(S[8])}}
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
.store-badges{display:flex;flex-wrap:wrap;justify-content:center;gap:${px(S[3])};margin:${px(S[8])} 0 0;padding:0;
  list-style:none}
.store-badge{display:inline-flex;align-items:center;gap:${px(S[3])};min-height:${px(L.buttonHeight + S[2])};
  padding:${px(S[2])} ${px(S[5])} ${px(S[2])} ${px(S[4])};border:${hairline('border-strong')};border-radius:${px(R.md)};
  background:${v('surface-base')};box-shadow:${shadow('sm')};${type(T.bodyStrong)};text-align:left}
.store-badge svg{width:${px(ICON.size + S[1])};height:${px(ICON.size + S[1])}}
.store-badge small{display:block;${micro};color:${v('text-secondary')}}
`;
}

function panelCss(): string {
  return `
.cta-panel{position:relative;overflow:hidden;isolation:isolate;text-align:center;
  padding:${px(rhythm.mobile)} ${px(S[5])};border-radius:${px(R.lg)};background:${v('surface-raised')};border:${hairline()}}
.cta-panel::before{content:"";position:absolute;inset:0;z-index:-2;${dotGrid('50% 100%')}}
.cta-panel::after{content:"";position:absolute;bottom:${px(-S[14] * 2)};z-index:-1;pointer-events:none;${amberGlow()}}
.cta-panel h2{${fluidType(webType.section)};max-width:${px(measure.prose)};margin:0 auto ${px(S[4])}}
.cta-panel .lead{max-width:${px(measure.prose)};margin:0 auto}
${mq(bp.lg)}{.cta-panel{padding:${px(rhythm.tablet)} ${px(S[14])}}}
`;
}
