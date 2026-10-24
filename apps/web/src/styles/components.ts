import {
  bp,
  fluidType,
  fx,
  hairline,
  ICON,
  L,
  label,
  measure,
  micro,
  mq,
  px,
  R,
  S,
  shadow,
  stroke,
  T,
  tint,
  type,
  v,
  webType,
} from './tokens';

/** Daylight tints (DESIGN-DAYLIGHT §Colour — extras): trust, people and delivery. */
export const TONES = ['sage', 'clay', 'haze'] as const;

/** Buttons, cards, badges, grids, FAQ, breadcrumbs, tabs, chips, notices (DESIGN.md §Components). */
export function componentsCss(): string {
  return [
    buttonsCss(),
    cardsCss(),
    badgesCss(),
    disclosureCss(),
    navigationCss(),
    noticeCss(),
  ].join('\n');
}

function buttonsCss(): string {
  return `
.btn{display:inline-flex;align-items:center;justify-content:center;gap:${px(S[2])};
  min-height:${px(L.buttonHeight)};padding:0 ${px(S[6])};border-radius:${px(R.full)};border:${hairline()};
  border-color:transparent;font:inherit;${type(T.bodyStrong)};text-decoration:none;cursor:pointer;
  white-space:nowrap}
.btn svg{flex-shrink:0}
.btn-primary{background:${v('accent-default')};color:${v('text-on-accent')};
  box-shadow:inset 0 ${px(-stroke.thick)} 0 ${v('accent-hover')}}
.btn-primary:hover{background:${v('accent-hover')}}
.btn-secondary{background:${v('surface-overlay')};border-color:${v('border-strong')};color:${v('text-primary')}}
.btn-secondary:hover{border-color:${v('text-tertiary')};box-shadow:${shadow('sm')}}
.btn-dark{background:${v('text-primary')};color:${v('surface-overlay')}}
.btn-dark:hover{box-shadow:${shadow('md')}}
.btn-sm{min-height:${px(L.minTapTarget)};padding:0 ${px(S[4])}}
.btn-arrow{display:inline-grid;place-items:center;width:${px(S[6] + S[1])};height:${px(S[6] + S[1])};
  margin-right:${px(-S[3] - S[1] / 2)};border-radius:${px(R.full)};background:${v('text-on-accent')};
  color:${v('surface-overlay')}}
.btn-arrow svg{width:${px(S[4])};height:${px(S[4])}}
.btn-dark .btn-arrow{background:${v('surface-overlay')};color:${v('text-primary')}}
.btn-secondary .btn-arrow{background:${v('text-primary')};color:${v('surface-overlay')}}
.btn-sm .btn-arrow{width:${px(S[6])};height:${px(S[6])};margin-right:${px(-S[2] - S[1] / 2)}}
.btn:focus-visible{outline-offset:${px(S[1])}}
.btn[aria-busy="true"]{cursor:progress}
.btn:disabled{opacity:${fx.disabledOpacity}}
.actions{display:flex;flex-wrap:wrap;gap:${px(S[3])};margin-top:${px(S[8])}}
.text-link{display:inline-flex;align-items:center;gap:${px(S[1])};min-height:${px(L.minTapTarget)};
  ${type(T.bodyStrong)};text-decoration:none}
.text-link:hover{text-decoration:underline}
`;
}

function cardsCss(): string {
  return `
.grid{display:grid;gap:${px(S[4])};grid-template-columns:minmax(0,1fr);list-style:none;margin:0;padding:0}
${mq(bp.sm)}{.grid-2,.grid-3,.grid-4,.grid-5{grid-template-columns:repeat(2,minmax(0,1fr))}}
${mq(bp.lg)}{
  .grid{gap:${px(S[6])}}
  .grid-3{grid-template-columns:repeat(3,minmax(0,1fr))}
  .grid-4{grid-template-columns:repeat(4,minmax(0,1fr))}
  .grid-5{grid-template-columns:repeat(5,minmax(0,1fr))}
}
.card{position:relative;display:flex;flex-direction:column;background:${v('surface-overlay')};
  border:${hairline()};border-radius:${px(R.lg)};padding:${px(S[5])}}
.card>:last-child{margin-bottom:0}
.card h3{margin-bottom:${px(S[2])}}
.card .muted{margin-bottom:${px(S[3])}}
.card-link{color:inherit;text-decoration:none}
.card-link::after{content:"";position:absolute;inset:0;border-radius:inherit}
@supports selector(:has(a)){
  .card-link:focus-visible{outline:none}
  .card:has(.card-link:focus-visible){outline:${px(stroke.thick)} solid ${v('text-primary')};
    outline-offset:${px(stroke.thick)}}
}
.card .push{margin-top:auto;padding-top:${px(S[4])}}
.lift:hover{box-shadow:${shadow('md')};border-color:${v('border-strong')}}
.card-arrow{position:absolute;top:${px(S[5])};right:${px(S[5])};color:${v('text-tertiary')}}
.lift:hover .card-arrow{color:${v('text-primary')}}
${mq(bp.lg)}{.card{padding:${px(S[6])}}.card-arrow{top:${px(S[6])};right:${px(S[6])}}}
.icon-chip{display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;
  width:${px(S[10])};height:${px(S[10])};margin-bottom:${px(S[5])};border-radius:${px(R.md)};
  background:${v('surface-raised')};color:${v('text-primary')}}
.icon-chip svg{width:${px(ICON.size)};height:${px(ICON.size)}}
${TONES.map((tone) => `.tone-${tone}{background:${v(`${tone}-default`)};border-color:transparent}
.tone-${tone} .icon-chip{background:${v('surface-overlay')};color:${v(`${tone}-deep`)}}
.tone-${tone} .muted,.tone-${tone} .chip{color:${v('text-secondary')}}`).join('\n')}
.price-note{${type(T.caption)};color:${v('text-secondary')};font-variant-numeric:tabular-nums;
  margin:${px(S[1])} 0 ${px(S[4])}}
.checklist{list-style:none;margin:0 0 ${px(S[4])};padding:0;display:grid;gap:${px(S[3])}}
.checklist li{position:relative;padding-left:${px(S[8] - S[1])};color:${v('text-secondary')}}
.checklist li::before{content:"";position:absolute;left:0;top:${px(S[1] / 2)};width:${px(S[5])};height:${px(S[5])};
  border-radius:${px(R.full)};background:${v('surface-base')};border:${hairline('border-strong')}}
.checklist li::after{content:"";position:absolute;left:${px(S[2] - stroke.hairline)};top:${px(S[1] + stroke.thick)};
  width:${px(S[1] + stroke.hairline)};height:${px(S[2] + stroke.hairline)};border:solid ${v('text-primary')};
  border-width:0 ${px(stroke.thick)} ${px(stroke.thick)} 0;transform:rotate(45deg)}
.checklist-out li::after{left:${px(S[1] + stroke.thick)};top:${px(S[3] - stroke.hairline)};width:${px(S[2] + stroke.hairline)};
  height:0;border-width:${px(stroke.thick)} 0 0;transform:none;border-color:${v('text-tertiary')}}
`;
}

function badgesCss(): string {
  const dot = (tone: string) =>
    `.badge-${tone}::before{content:"";width:${px(S[2] - stroke.thick)};height:${px(S[2] - stroke.thick)};
  border-radius:${px(R.full)};background:${v(tone === 'live' ? 'success' : 'warning')}}`;
  return `
.badge{display:inline-flex;align-items:center;gap:${px(S[2])};align-self:flex-start;${label};
  padding:${px(S[1] + stroke.hairline)} ${px(S[3])};border-radius:${px(R.full)};background:${v('surface-overlay')};
  border:${hairline()};color:${v('text-secondary')};margin-bottom:${px(S[4])}}
${dot('live')}
${dot('pilot')}
.badge-live{color:${v('success')}}
.badge-pilot{color:${v('warning')}}
.badge-emergency{background:${v('emergency-subtle')};border-color:transparent;color:${v('emergency-default')}}
.pill{display:inline-flex;align-items:center;gap:${px(S[2])};min-height:${px(S[8])};padding:0 ${px(S[4])};
  border-radius:${px(R.full)};background:${v('accent-subtle')};${label};color:${v('text-primary')}}
.live-dot{position:relative;display:inline-block;flex-shrink:0;width:${px(S[2])};height:${px(S[2])};
  border-radius:${px(R.full)};background:${v('accent-default')};box-shadow:0 0 0 ${px(S[1])} ${v('surface-overlay')}}
.live-dot::after{content:"";position:absolute;inset:0;border-radius:inherit;background:inherit;opacity:0}
.chips{display:flex;flex-wrap:wrap;gap:${px(S[2])};list-style:none;margin:0;padding:0}
.chip{display:inline-flex;align-items:center;gap:${px(S[2])};min-height:${px(S[8])};padding:0 ${px(S[3])};
  border-radius:${px(R.full)};background:${v('surface-overlay')};border:${hairline()};
  color:${v('text-secondary')};${type(T.caption)}}
.chip svg{width:${px(S[4])};height:${px(S[4])};color:${v('text-tertiary')}}
`;
}

/** A plus sign drawn with two gradient bars, centred in its box. */
function plus(colour: string): string {
  const bar = `linear-gradient(${v(colour)},${v(colour)})`;
  const arm = px(S[3]);
  const w = px(stroke.thick);
  return `${bar} center/${arm} ${w} no-repeat,${bar} center/${w} ${arm} no-repeat`;
}

function disclosureCss(): string {
  return `
.faq{display:grid;max-width:${px(measure.prose)};border-top:${hairline()}}
.faq details{border-bottom:${hairline()}}
.faq summary{display:flex;justify-content:space-between;align-items:center;gap:${px(S[6])};
  min-height:${px(L.minTapTarget)};padding:${px(S[5])} 0;${fluidType(webType.title)};font-weight:${T.bodyStrong.weight};
  cursor:pointer;list-style:none}
.faq summary::-webkit-details-marker{display:none}
.faq summary::after{content:"";flex-shrink:0;width:${px(S[8] + S[1])};height:${px(S[8] + S[1])};
  border:${hairline('border-strong')};border-radius:${px(R.full)};background:${plus('text-secondary')}}
.faq details[open] summary::after{transform:rotate(45deg);border-color:${v('accent-default')};
  background:${plus('text-on-accent')},${v('accent-default')}}
.faq .answer{padding:0 ${px(S[10])} ${px(S[6])} 0;color:${v('text-secondary')}}
.faq .answer p{margin:0}
.section-split .faq{max-width:none}
`;
}

function navigationCss(): string {
  return `
.breadcrumbs ol{display:flex;flex-wrap:wrap;align-items:center;column-gap:${px(S[2])};list-style:none;margin:0 0 ${px(S[4])};
  padding:0;${type(T.caption)};color:${v('text-secondary')}}
.breadcrumbs li+li::before{content:"/";margin-right:${px(S[2])};color:${v('text-tertiary')}}
.breadcrumbs li{display:inline-flex;align-items:center;min-height:${px(L.minTapTarget)}}
.breadcrumbs a{display:inline-flex;align-items:center;min-height:${px(L.minTapTarget)};color:${v('text-secondary')};
  text-decoration:none}
.breadcrumbs a:hover{color:${v('text-primary')};text-decoration:underline}
.breadcrumbs [aria-current="page"]{color:${v('text-primary')}}
.tabs{display:inline-flex;flex-wrap:wrap;gap:${px(S[1])};padding:${px(S[1])};margin-bottom:${px(S[8])};
  background:${v('surface-raised')};border:${hairline()};border-radius:${px(R.full)}}
.tab{min-height:${px(L.minTapTarget)};padding:0 ${px(S[5])};border:${hairline()};border-color:transparent;
  border-radius:${px(R.full)};background:transparent;color:${v('text-secondary')};font:inherit;
  ${type(T.bodyStrong)};cursor:pointer}
.tab:hover{color:${v('text-primary')}}
.tab[aria-selected="true"]{background:${v('surface-overlay')};border-color:${v('border-subtle')};
  color:${v('text-primary')};box-shadow:${shadow('sm')}}
.link-list{display:flex;flex-wrap:wrap;gap:0 ${px(S[4])};list-style:none;margin:0;padding:0}
.link-list a{display:inline-flex;align-items:center;min-height:${px(L.minTapTarget)}}
`;
}

function noticeCss(): string {
  return `
.notice{display:flex;gap:${px(S[4])};background:${v('surface-raised')};border:${hairline()};
  border-radius:${px(R.lg)};padding:${px(S[5])}}
.notice>div>:last-child,.notice>:last-child{margin-bottom:0}
.notice>svg{flex-shrink:0;width:${px(ICON.size)};height:${px(ICON.size)};margin-top:${px(stroke.thick)}}
.gap-top{margin-top:${px(S[8])}}
.notice p{max-width:${px(measure.prose)}}
.notice-title{${type(T.bodyStrong)};margin:0 0 ${px(S[1])}}
.notice-success{background:${tint('success', fx.noticeTint)};border-color:${tint('success', fx.noticeEdge)}}
.notice-error{background:${tint('danger', fx.noticeTint)};border-color:${tint('danger', fx.noticeEdge)}}
.notice-emergency{background:${v('emergency-subtle')};border-color:transparent}
.notice-emergency>svg{color:${v('emergency-default')}}
`;
}
