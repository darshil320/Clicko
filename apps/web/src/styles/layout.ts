import {
  bp,
  fluidType,
  fontDisplay,
  fx,
  hairline,
  headerHeight,
  L,
  measure,
  micro,
  mq,
  px,
  R,
  rhythm,
  S,
  shadow,
  T,
  tint,
  tracking,
  type,
  v,
  webType,
} from './tokens';

/** Page frame: container, glass header, section rhythm, footer. Mobile first. */
export function layoutCss(): string {
  return [headerCss(), sectionCss(), footerCss()].join('\n');
}

function headerCss(): string {
  return `
.wrap{max-width:${px(measure.page + L.screenPaddingX * 2)};margin-left:auto;margin-right:auto;
  padding-left:${px(L.screenPaddingX)};padding-right:${px(L.screenPaddingX)}}
.site-header{position:relative;z-index:10;background:${v('surface-base')};
  background:${tint('surface-base', fx.glassPercent)};
  -webkit-backdrop-filter:saturate(${fx.glassSaturate}) blur(${px(fx.glassBlur)});
  backdrop-filter:saturate(${fx.glassSaturate}) blur(${px(fx.glassBlur)});border-bottom:${hairline()}}
.site-header .bar{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;
  column-gap:${px(S[4])};min-height:${px(headerHeight)}}
.brand{display:inline-flex;align-items:center;gap:${px(S[2])};min-height:${px(L.minTapTarget)};
  font-family:${fontDisplay};${type(T.h2)};font-weight:${T.display.weight};letter-spacing:${tracking.title}em;
  color:${v('text-primary')};text-decoration:none}
.brand img{width:${px(S[8])};height:${px(S[8])}}
.site-nav{order:3;flex-basis:100%;overflow-x:auto;border-top:${hairline()};scrollbar-width:none}
.nav-list{display:flex;justify-content:space-between;list-style:none;margin:0;padding:${px(S[1])} 0}
.nav-list a{display:inline-flex;align-items:center;min-height:${px(L.minTapTarget)};padding:0 ${px(S[2])};
  ${type(T.caption)};font-weight:${T.bodyStrong.weight};border-radius:${px(R.full)};color:${v('text-secondary')};
  text-decoration:none;white-space:nowrap}
.nav-list a:hover{color:${v('text-primary')};background:${v('surface-raised')}}
.nav-list li:first-child a{padding-left:0}
.nav-list li:last-child a{padding-right:0}
.header-cta{flex-shrink:0}
${mq(bp.sm)}{.nav-list{justify-content:flex-start;gap:${px(S[1])}}.nav-list a{${type(T.body)};
  font-weight:${T.bodyStrong.weight};padding:0 ${px(S[3])}}}
${mq(bp.lg)}{
  .site-header{position:sticky;top:0}
  [id]{scroll-margin-top:${px(headerHeight + S[6])}}
  .site-nav{order:0;flex-basis:auto;border-top:0;overflow:visible;margin-left:auto}
  .nav-list li:first-child a,.nav-list li:last-child a{padding-left:${px(S[3])};padding-right:${px(S[3])}}
}
`;
}

function sectionCss(): string {
  return `
.page{display:block}
.section{position:relative;padding-top:${px(rhythm.mobile)};padding-bottom:${px(rhythm.mobile)}}
.section-raised{background:${v('surface-raised')};border-top:${hairline()};border-bottom:${hairline()}}
.section-raised .card{background:${v('surface-base')};box-shadow:${shadow('sm')}}
.section-head{max-width:${px(measure.prose)};margin-bottom:${px(S[10])}}
.section-head h2{${fluidType(webType.section)};margin-bottom:${px(S[4])}}
.section-head .lead{margin:0}
.section-head-center{margin-left:auto;margin-right:auto;text-align:center}
.lead{${fluidType(webType.lead)};color:${v('text-secondary')}}
.section-foot{margin-top:${px(S[8])};color:${v('text-secondary')};${type(T.caption)}}
.section-split{display:grid;gap:${px(S[8])}}
.section-split .section-head{margin-bottom:0}
${mq(bp.sm)}{.section{padding-top:${px(rhythm.tablet)};padding-bottom:${px(rhythm.tablet)}}}
${mq(bp.lg)}{
  .section{padding-top:${px(rhythm.desktop)};padding-bottom:${px(rhythm.desktop)}}
  .section-head{margin-bottom:${px(S[14])}}
  .section-split{grid-template-columns:minmax(0,5fr) minmax(0,7fr);gap:${px(S[14])};align-items:start}
  .section-split .section-head{position:sticky;top:${px(headerHeight + S[10])}}
}
.page-hero{position:relative;overflow:hidden;isolation:isolate;padding-top:${px(S[8])};
  padding-bottom:${px(rhythm.mobile)};border-bottom:${hairline()}}
.page-hero h1{${fluidType(webType.page)};max-width:${px(measure.hero)};margin-bottom:${px(S[5])}}
.page-hero .lead{max-width:${px(measure.prose)}}
${mq(bp.lg)}{.page-hero{padding-top:${px(S[10])};padding-bottom:${px(rhythm.tablet)}}}
`;
}

function footerCss(): string {
  return `
.site-footer{background:${v('surface-raised')};border-top:${hairline()};padding:${px(rhythm.mobile)} 0 ${px(S[8])};
  color:${v('text-secondary')};${type(T.caption)}}
.footer-grid{display:grid;gap:${px(S[8])};grid-template-columns:minmax(0,1fr)}
.site-footer h2{${micro};color:${v('text-secondary')};font-family:inherit;margin:0 0 ${px(S[2])}}
.footer-brand{display:inline-flex;align-items:center;gap:${px(S[2])};font-family:${fontDisplay};${type(T.h2)};
  font-weight:${T.display.weight};letter-spacing:${tracking.title}em;color:${v('text-primary')};margin:0 0 ${px(S[3])}}
.footer-brand img{width:${px(S[6])};height:${px(S[6])}}
.footer-about{max-width:${px(measure.prose / 2)}}
.site-footer ul{list-style:none;margin:0;padding:0}
.site-footer a{display:inline-flex;align-items:center;min-height:${px(L.minTapTarget)};color:${v('text-primary')};
  text-decoration:none}
.site-footer a:hover{text-decoration:underline}
.footer-legal{margin-top:${px(S[10])};padding-top:${px(S[6])};border-top:${hairline()};display:grid;gap:${px(S[2])}}
.footer-legal p{margin:0}
${mq(bp.sm)}{
  .site-footer{padding-top:${px(rhythm.tablet)}}
  .footer-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
}
${mq(bp.lg)}{.footer-grid{grid-template-columns:minmax(0,2fr) repeat(3,minmax(0,1fr));gap:${px(S[10])}}}
`;
}
