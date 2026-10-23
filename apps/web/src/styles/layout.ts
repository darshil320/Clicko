import {
  bp,
  displayWide,
  fontDisplay,
  hairline,
  L,
  measure,
  micro,
  mq,
  px,
  R,
  S,
  T,
  type,
  v,
} from './tokens';

/** Page frame: container, header, sections, footer. Mobile first. */
export function layoutCss(): string {
  return `
.wrap{max-width:${px(measure.page)};margin-left:auto;margin-right:auto;
  padding-left:${px(L.screenPaddingX)};padding-right:${px(L.screenPaddingX)}}
.site-header{position:relative;z-index:10;background:${v('surface-base')};border-bottom:${hairline()}}
.site-header .bar{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;
  column-gap:${px(S[4])}}
.brand{display:inline-flex;align-items:center;min-height:${px(S[14])};font-family:${fontDisplay};
  ${type(T.h2)};color:${v('text-primary')};text-decoration:none}
.brand:hover{color:${v('text-primary')}}
.site-nav{flex-basis:100%;overflow-x:auto;border-top:${hairline()}}
.nav-list{display:flex;justify-content:space-between;list-style:none;margin:0;padding:${px(S[1])} 0}
.nav-list a{display:inline-flex;align-items:center;min-height:${px(L.minTapTarget)};padding:0 ${px(S[2])};
  ${type(T.caption)};
  border-radius:${px(R.md)};color:${v('text-secondary')};text-decoration:none;white-space:nowrap}
.nav-list li:first-child a{padding-left:0}
.nav-list li:last-child a{padding-right:0}
${mq(bp.sm)}{.nav-list{justify-content:flex-start;gap:${px(S[1])}}.nav-list a{${type(T.body)};padding:0 ${px(S[3])}}}
.nav-list a:hover{color:${v('text-primary')}}
.nav-list a[aria-current="page"]{color:${v('text-primary')}}
${mq(bp.lg)}{
  .site-header{position:sticky;top:0}
  [id]{scroll-margin-top:${px(S[14] + S[4])}}
  .site-nav{flex-basis:auto;border-top:0;overflow:visible}
  .nav-list li:first-child a,.nav-list li:last-child a{padding-left:${px(S[3])};padding-right:${px(S[3])}}
}
.page{display:block}
.section{padding-top:${px(S[10])};padding-bottom:${px(S[10])}}
.section-raised{background:${v('surface-raised')};border-top:${hairline()};border-bottom:${hairline()}}
.section-raised .card{background:${v('surface-base')}}
.section-head{max-width:${px(measure.prose)};margin-bottom:${px(S[8])}}
.section-head h2{${type(T.h1)}}
.lead{${type(T.h3)};font-weight:${T.body.weight};color:${v('text-secondary')}}
.section-foot{margin-top:${px(S[6])};color:${v('text-secondary')};${type(T.caption)}}
${mq(bp.lg)}{
  .section{padding-top:${px(S[14] + S[10])};padding-bottom:${px(S[14] + S[10])}}
  .section-head h2{${type(T.display)}}
}
.site-footer{background:${v('surface-raised')};border-top:${hairline()};padding:${px(S[10])} 0;
  color:${v('text-secondary')};${type(T.caption)}}
.footer-grid{display:grid;gap:${px(S[8])};grid-template-columns:minmax(0,1fr)}
.site-footer h2{${micro};color:${v('text-secondary')};margin:0 0 ${px(S[2])}}
.footer-brand{font-family:${fontDisplay};${type(T.h2)};color:${v('text-primary')};margin:0 0 ${px(S[2])}}
.site-footer ul{list-style:none;margin:0;padding:0}
.site-footer a{display:inline-flex;align-items:center;min-height:${px(L.minTapTarget)};color:${v('text-primary')};
  text-decoration:none}
.site-footer a:hover{text-decoration:underline;color:${v('text-primary')}}
.footer-legal{margin-top:${px(S[8])};padding-top:${px(S[6])};border-top:${hairline()}}
.footer-legal p{margin:0 0 ${px(S[2])}}
${mq(bp.sm)}{.footer-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
${mq(bp.lg)}{.footer-grid{grid-template-columns:2fr 1fr 1fr 1fr}}
.hero{padding-top:${px(S[10])};padding-bottom:${px(S[14])}}
.hero-grid{display:grid;gap:${px(S[10])};align-items:center}
.hero h1{${type(T.display)};margin-bottom:${px(S[4])}}
.hero .lead{max-width:${px(measure.prose)}}
${mq(bp.lg)}{
  .hero{padding-top:${px(S[14] + S[10])};padding-bottom:${px(S[14] + S[10])}}
  .hero-grid{grid-template-columns:minmax(0,7fr) minmax(0,5fr);gap:${px(S[14])}}
  .hero h1{font-size:${px(displayWide.size)};line-height:${px(displayWide.lineHeight)}}
}
.page-hero{padding-top:${px(S[8])};padding-bottom:${px(S[10])};border-bottom:${hairline()}}
.page-hero h1{${type(T.display)}}
${mq(bp.lg)}{.page-hero{padding-top:${px(S[10])};padding-bottom:${px(S[14])}}}
`;
}
