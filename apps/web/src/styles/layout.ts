import {
  bp,
  fluid,
  fluidType,
  fontBody,
  fontDisplay,
  fx,
  hairline,
  headerHeight,
  headerInset,
  headerOverlay,
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
  tint,
  tracking,
  type,
  v,
  webType,
  wordmark,
} from './tokens';

/** Page frame: container, floating header, section rhythm and heads, dark band, footer. Mobile first. */
export function layoutCss(): string {
  return [headerCss(), sectionCss(), darkCss(), footerCss()].join('\n');
}

/** The brand lockup: lens mark + name in the body sans at weight 700 (ADR-0018 §Logo). */
const lockup = `display:inline-flex;align-items:center;gap:${px(S[2])};font-family:${fontBody};${type(T.h2)};
  font-weight:${T.h1.weight};letter-spacing:${tracking.lockup}em;text-decoration:none`;

function headerCss(): string {
  return `
.wrap{max-width:${px(measure.page + L.screenPaddingX * 2)};margin-left:auto;margin-right:auto;
  padding-left:${px(L.screenPaddingX)};padding-right:${px(L.screenPaddingX)}}
.site-header{position:relative;z-index:10;background:${tint('surface-base', fx.glassPercent)};
  -webkit-backdrop-filter:saturate(${fx.glassSaturate}) blur(${px(fx.glassBlur)});
  backdrop-filter:saturate(${fx.glassSaturate}) blur(${px(fx.glassBlur)});border-bottom:${hairline()}}
.site-header .bar{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;
  column-gap:${px(S[4])};min-height:${px(headerHeight)}}
.brand{${lockup};min-height:${px(L.minTapTarget)};color:${v('text-primary')}}
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
  .site-header{position:sticky;top:0;padding-top:${px(headerInset)};margin-bottom:${px(-headerOverlay)};
    background:none;border:0;
    -webkit-backdrop-filter:none;backdrop-filter:none;pointer-events:none}
  .site-header .bar{pointer-events:auto;max-width:${px(measure.page)};padding:0 ${px(S[2])} 0 ${px(S[5])};
    min-height:${px(headerHeight)};border:${hairline()};border-radius:${px(R.full)};box-shadow:${shadow('md')};
    background:${tint('surface-overlay', fx.glassPercent)};
    -webkit-backdrop-filter:saturate(${fx.glassSaturate}) blur(${px(fx.glassBlur * 2)});
    backdrop-filter:saturate(${fx.glassSaturate}) blur(${px(fx.glassBlur * 2)})}
  [id]{scroll-margin-top:${px(headerHeight + S[10])}}
  .site-nav{order:0;flex-basis:auto;border-top:0;overflow:visible;margin:0 auto}
  .nav-list a{${type(T.caption)};font-weight:${T.bodyStrong.weight};padding:0 ${px(S[4])}}
  .nav-list li:first-child a,.nav-list li:last-child a{padding-left:${px(S[4])};padding-right:${px(S[4])}}
}
`;
}

function sectionCss(): string {
  return `
.page{display:block}
.section{position:relative;padding-top:${px(rhythm.mobile)};padding-bottom:${px(rhythm.mobile)}}
.section-raised{background:${v('surface-raised')}}
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
  .wrap:not(.section-split)>.section-head:not(.section-head-center){display:grid;max-width:none;
    grid-template-columns:minmax(0,7fr) minmax(0,4fr);column-gap:${px(S[14])};align-items:end}
  .wrap:not(.section-split)>.section-head:not(.section-head-center)>*{grid-column:1}
  .wrap:not(.section-split)>.section-head:not(.section-head-center) h2{margin:0;max-width:${px((measure.hero * 2) / 3)}}
  .wrap:not(.section-split)>.section-head:not(.section-head-center) .lead{grid-column:2;grid-row:1/span 2;align-self:end;
    ${type(T.body)};font-size:${px(T.h3.size)}}
  .section-split{grid-template-columns:minmax(0,5fr) minmax(0,7fr);gap:${px(S[14])};align-items:start}
  .section-split .section-head{position:sticky;top:${px(headerHeight + S[14])}}
}
.page-hero{position:relative;overflow:hidden;isolation:isolate;padding-top:${px(S[8])};
  padding-bottom:${px(rhythm.mobile)}}
.page-hero h1{${fluidType(webType.page)};max-width:${px(measure.hero)};margin-bottom:${px(S[5])}}
.page-hero .lead{max-width:${px(measure.prose)}}
.page-hero-grid{display:grid;gap:${px(S[10])};align-items:center}
.page-hero-grid .photo{max-width:${px(measure.stage)};width:100%}
${mq(bp.lg)}{
  .page-hero{padding-top:${px(S[14] + headerOverlay)};padding-bottom:${px(rhythm.tablet)}}
  .page-hero-grid{grid-template-columns:minmax(0,7fr) minmax(0,5fr);gap:${px(S[14])}}
  .page-hero-grid .photo{justify-self:end;box-shadow:${shadow('photo')}}
}
`;
}

/** The one darkroom band per page (DESIGN-DAYLIGHT §Rules): Emergency on the home page. */
function darkCss(): string {
  const on = 'darkroom-text';
  const muted = 'darkroom-muted';
  const rule = `${px(stroke.hairline)} solid ${tint(on, fx.darkRulePercent)}`;
  return `
.section-dark{margin:0 ${px(S[2])};border-radius:${px(RD.photo)};background:${v('darkroom-default')};
  color:${v(on)};overflow:hidden;isolation:isolate}
.section-dark .eyebrow,.section-dark .lead,.section-dark .muted,.section-dark .notice p{color:${v(muted)}}
.section-dark h2,.section-dark h3,.section-dark .notice-title{color:${v(on)}}
.section-dark h2 em{color:${v('accent-default')}}
.section-dark a{color:${v(on)}}
.section-dark .bands,.section-dark .bands-head,.section-dark .band-row{border-color:${tint(on, fx.darkRulePercent)}}
.section-dark .band-row{background:${tint(on, fx.darkWellPercent)};border:${rule}}
.section-dark .band-row dt,.section-dark .bands-head{color:${v(muted)}}
.section-dark .band-row dd{color:${v(on)}}
.section-dark .notice{background:${tint(on, fx.darkWellPercent)};border:${rule}}
${mq(bp.lg)}{
  .section-dark{margin:0 ${px(S[4])};border-radius:${px(RD.panel)}}
  .section-dark .band-row{background:none;border:0;border-bottom:${rule}}
  .section-dark .band-row dd{color:${v(muted)}}
  .section-dark .band-row dd.num{color:${v(on)}}
}
`;
}

function footerCss(): string {
  const on = 'darkroom-text';
  const muted = 'darkroom-muted';
  return `
.site-footer{margin:${px(S[2])};padding:${px(rhythm.mobile)} 0 ${px(S[6])};border-radius:${px(RD.photo)};
  background:${v('darkroom-default')};color:${v(muted)};${type(T.caption)};overflow:hidden}
.footer-grid{display:grid;gap:${px(S[8])};grid-template-columns:minmax(0,1fr)}
.site-footer h2{${label};color:${v(muted)};margin:0 0 ${px(S[3])}}
.footer-brand{${lockup};color:${v(on)};margin:0 0 ${px(S[3])}}
.footer-brand img{width:${px(S[6])};height:${px(S[6])}}
.footer-about{max-width:${px(measure.prose / 2)}}
.site-footer ul{list-style:none;margin:0;padding:0}
.site-footer a{display:inline-flex;align-items:center;min-height:${px(L.minTapTarget)};color:${v(on)};
  text-decoration:none}
.site-footer a:hover{text-decoration:underline;text-decoration-color:${v('accent-default')}}
.footer-wordmark{margin:${px(S[10])} 0 0;font-family:${fontDisplay};font-size:${fluid(wordmark.min, wordmark.max)};
  line-height:${wordmark.leading};letter-spacing:${tracking.wordmark}em;color:${v(on)};white-space:nowrap}
.footer-legal{margin-top:${px(S[8])};padding-top:${px(S[6])};border-top:${px(stroke.hairline)} solid
  ${tint(on, fx.darkRulePercent)};display:grid;gap:${px(S[2])}}
.footer-legal p{margin:0}
${mq(bp.sm)}{
  .site-footer{padding-top:${px(rhythm.tablet)}}
  .footer-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
}
${mq(bp.lg)}{
  .site-footer{margin:${px(S[4])};border-radius:${px(RD.panel)}}
  .footer-grid{grid-template-columns:minmax(0,2fr) repeat(3,minmax(0,1fr));gap:${px(S[10])}}
}
`;
}
