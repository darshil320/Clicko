import {
  bp,
  fontDisplay,
  hairline,
  L,
  measure,
  micro,
  mq,
  px,
  R,
  S,
  stroke,
  T,
  type,
  v,
} from './tokens';

const EDGES = ['tertiary', 'secondary', 'primary'] as const;

/** Buttons, cards, badges, grids, FAQ, breadcrumbs, tabs and form controls (DESIGN.md §Components). */
export function componentsCss(): string {
  const edges = EDGES.map((tone) => `.edge-${tone}{border-left-color:${v(`text-${tone}`)}}`).join(
    '',
  );
  return `
.btn{display:inline-flex;align-items:center;justify-content:center;gap:${px(S[2])};
  min-height:${px(L.buttonHeight)};padding:0 ${px(S[5])};border-radius:${px(R.md)};border:${hairline()};
  border-color:transparent;font:inherit;${type(T.bodyStrong)};text-decoration:none;cursor:pointer}
.btn-primary{background:${v('accent-default')};color:${v('text-on-accent')}}
.btn-primary:hover{background:${v('accent-hover')};color:${v('text-on-accent')}}
.btn-secondary{background:${v('surface-raised')};border-color:${v('border-strong')};color:${v('text-primary')}}
.btn-secondary:hover{background:${v('surface-overlay')};color:${v('text-primary')}}
.btn[aria-busy="true"]{cursor:progress}
.actions{display:flex;flex-wrap:wrap;gap:${px(S[3])};margin-top:${px(S[6])}}
.grid{display:grid;gap:${px(L.cardGap)};grid-template-columns:minmax(0,1fr);list-style:none;margin:0;padding:0}
${mq(bp.sm)}{.grid-2,.grid-3,.grid-4,.grid-5{grid-template-columns:repeat(2,minmax(0,1fr))}}
${mq(bp.lg)}{
  .grid-3{grid-template-columns:repeat(3,minmax(0,1fr))}
  .grid-4{grid-template-columns:repeat(4,minmax(0,1fr))}
  .grid-5{grid-template-columns:repeat(5,minmax(0,1fr))}
}
.card{display:flex;flex-direction:column;background:${v('surface-raised')};border:${hairline()};
  border-radius:${px(R.lg)};padding:${px(L.cardPadding)}}
.card>:last-child{margin-bottom:0}
.card h3{margin-bottom:${px(S[2])}}
.card-link{color:inherit;text-decoration:none}
.card-link:hover h3{text-decoration:underline;text-decoration-color:${v('accent-default')}}
.card .push{margin-top:auto;padding-top:${px(S[4])}}
${mq(bp.lg)}{.card{padding:${px(S[5])}}}
.edge{border-left:${px(stroke.thick)} solid ${v('border-strong')}}
${edges}
.edge-accent{border-left-color:${v('accent-default')}}
.edge-strong{border-left-color:${v('border-strong')}}
.edge-emergency{border-left-color:${v('emergency-default')}}
.badge{display:inline-flex;align-items:center;gap:${px(S[1])};align-self:flex-start;${micro};
  padding:${px(S[1])} ${px(S[2])};border-radius:${px(R.full)};background:${v('surface-overlay')};
  color:${v('text-secondary')};margin-bottom:${px(S[3])}}
.badge-live{color:${v('success')}}
.badge-pilot{color:${v('warning')}}
.badge-emergency{background:${v('emergency-subtle')};color:${v('emergency-default')}}
.tier-name{${micro};color:${v('text-secondary')};margin:0 0 ${px(S[2])}}
.price-line{font-family:${fontDisplay};${type(T.h1)};font-variant-numeric:tabular-nums;margin:0}
.price-line small{${type(T.body)};color:${v('text-secondary')};font-family:inherit}
.price-note{${type(T.caption)};color:${v('text-secondary')};font-variant-numeric:tabular-nums;
  margin:${px(S[1])} 0 ${px(S[4])}}
.checklist{list-style:none;margin:0 0 ${px(S[4])};padding:0;display:grid;gap:${px(S[2])}}
.checklist li{position:relative;padding-left:${px(S[6])}}
.checklist li::before{content:"✓";position:absolute;left:0;color:${v('text-secondary')}}
.checklist-out li::before{content:"–"}
.faq{display:grid;gap:${px(S[2])};max-width:${px(measure.prose)}}
.faq details{background:${v('surface-raised')};border:${hairline()};border-radius:${px(R.md)}}
.faq summary{display:flex;justify-content:space-between;align-items:center;gap:${px(S[4])};
  min-height:${px(L.minTapTarget)};padding:${px(S[3])} ${px(S[4])};${type(T.bodyStrong)};cursor:pointer;
  list-style:none}
.faq summary::-webkit-details-marker{display:none}
.faq summary::after{content:"+";color:${v('text-secondary')};${type(T.h2)}}
.faq details[open] summary::after{content:"–"}
.faq .answer{padding:0 ${px(S[4])} ${px(S[4])};color:${v('text-secondary')}}
.faq .answer p{margin:0}
.breadcrumbs ol{display:flex;flex-wrap:wrap;gap:${px(S[2])};list-style:none;margin:0 0 ${px(S[6])};
  padding:0;${type(T.caption)};color:${v('text-secondary')}}
.breadcrumbs li+li::before{content:"/";margin-right:${px(S[2])}}
.breadcrumbs a{color:${v('text-secondary')}}
.breadcrumbs [aria-current="page"]{color:${v('text-primary')}}
.tabs{display:inline-flex;flex-wrap:wrap;gap:${px(S[1])};padding:${px(S[1])};margin-bottom:${px(S[6])};
  background:${v('surface-raised')};border:${hairline()};border-radius:${px(R.full)}}
.tab{min-height:${px(L.minTapTarget)};padding:0 ${px(S[5])};border:0;border-radius:${px(R.full)};
  background:transparent;color:${v('text-secondary')};font:inherit;${type(T.bodyStrong)};cursor:pointer}
.tab:hover{color:${v('text-primary')}}
.tab[aria-selected="true"]{background:${v('accent-subtle')};color:${v('accent-default')}}
.chips{display:flex;flex-wrap:wrap;gap:${px(S[2])};list-style:none;margin:0;padding:0}
.chip{display:inline-flex;align-items:center;min-height:${px(S[8])};padding:0 ${px(S[3])};
  border-radius:${px(R.full)};background:${v('surface-raised')};border:${hairline()};
  color:${v('text-secondary')};${type(T.caption)}}
.link-list{display:flex;flex-wrap:wrap;gap:0 ${px(S[4])};list-style:none;margin:0;padding:0}
.link-list a{display:inline-flex;align-items:center;min-height:${px(L.minTapTarget)}}
.notice{background:${v('surface-raised')};border:${hairline()};border-left:${px(stroke.thick)} solid
  ${v('border-strong')};border-radius:${px(R.md)};padding:${px(S[4])}}
.notice>:last-child{margin-bottom:0}
.gap-top{margin-top:${px(S[6])}}
.notice-title{${type(T.bodyStrong)};margin:0 0 ${px(S[1])}}
.notice-success{border-left-color:${v('success')}}
.notice-error{border-left-color:${v('danger')}}
.notice-emergency{border-left-color:${v('emergency-default')}}
`;
}
