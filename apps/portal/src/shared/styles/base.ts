import {
  below,
  bp,
  c,
  column,
  FONT_BODY,
  FONT_DISPLAY,
  font,
  layout,
  MICRO,
  motion,
  ms,
  px,
  radius,
  sectionSpace,
  space,
  up,
} from './vars';

/** Reset, typography, page chrome, layout utilities and motion (DESIGN-LIGHT §Motion). */
export function baseCss(): string {
  return `
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;min-height:100vh;background:${c('surface-base')};color:${c('text-primary')};
  font-family:${FONT_BODY};${font('body')};-webkit-font-smoothing:antialiased;
  -moz-osx-font-smoothing:grayscale;text-rendering:optimizeLegibility}
h1,h2,h3{margin:0;font-family:${FONT_DISPLAY};color:${c('text-primary')}}
h1{${font('h1')};font-weight:700}
${up(bp.sm, `h1{${font('display')}}`)}
h2{${font('h2')};font-weight:600}
h3{${font('h3')};font-weight:600}
p{margin:0}
a{color:inherit}
strong{font-weight:600}
::selection{background:${c('accent-subtle')};color:${c('text-primary')}}
:focus-visible{outline:2px solid ${c('text-primary')};outline-offset:2px}

/* page chrome */
header.top{position:sticky;top:0;z-index:10;border-bottom:1px solid ${c('border-subtle')};
  background:color-mix(in srgb,${c('surface-base')} 88%,transparent);
  backdrop-filter:blur(${px(space[3])});-webkit-backdrop-filter:blur(${px(space[3])})}
.top-inner{max-width:${px(column.main)};margin:0 auto;padding:${px(space[3])} ${px(space[5])};
  display:flex;align-items:center;justify-content:space-between;gap:${px(space[4])}}
${up(bp.sm, `.top-inner{padding:${px(space[3])} ${px(space[8])}}`)}
.brand{display:inline-flex;align-items:center;gap:${px(space[2])};min-height:${px(layout.minTapTarget)};
  font-family:${FONT_DISPLAY};${font('h3')};font-weight:700;color:${c('text-primary')};text-decoration:none}
.brand-mark{width:${px(space[3])};height:${px(space[3])};border-radius:${px(radius.full)};
  background:${c('accent-default')};box-shadow:0 0 0 ${px(space[1])} ${c('accent-subtle')}}
.brand-sub{color:${c('text-tertiary')};font-weight:500}
.nav{display:flex;align-items:center;gap:${px(space[2])}}
.nav-link{display:inline-flex;align-items:center;min-height:${px(layout.minTapTarget)};padding:0 ${px(space[3])};
  border-radius:${px(radius.md)};color:${c('text-secondary')};font-weight:500;text-decoration:none;
  transition:background-color var(--fast) var(--ease),color var(--fast) var(--ease)}
.nav-link:hover{background:${c('surface-raised')};color:${c('text-primary')}}
.user{display:flex;align-items:center;gap:${px(space[2])};padding-left:${px(space[2])};
  margin-left:${px(space[1])};border-left:1px solid ${c('border-subtle')}}
.avatar{display:grid;place-items:center;width:${px(space[8])};height:${px(space[8])};flex:none;
  border-radius:${px(radius.full)};background:${c('accent-subtle')};color:${c('text-on-accent')};
  ${MICRO};letter-spacing:0}
${below(
  bp.sm,
  `.nav-link{display:none}.user{border-left:0;padding-left:0;margin-left:0}
  .sm-hidden{position:absolute;width:1px;height:1px;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}`,
)}
.user-name{display:none;${font('caption')};color:${c('text-secondary')};font-weight:500}
${up(bp.sm, '.user-name{display:inline}')}
main{max-width:${px(column.main)};margin:0 auto;
  padding:${px(space[10])} ${px(space[5])} ${px(sectionSpace.mobile)}}
${up(bp.sm, `main{padding:${px(space[14])} ${px(space[8])} ${px(sectionSpace.tablet)}}`)}

/* layout */
.page{display:flex;flex-direction:column;gap:${px(space[8])}}
.page-head{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:${px(space[6])}}
.page-head>div{display:flex;flex-direction:column;gap:${px(space[2])};min-width:0}
.lede{color:${c('text-secondary')};max-width:${px(sectionSpace.readingMax)}}
.eyebrow{${MICRO};color:${c('text-tertiary')}}
.stack{display:flex;flex-direction:column;gap:${px(space[3])}}
.stack.loose{gap:${px(space[6])}}
.stack.tight{gap:${px(space[1])}}
.row{display:flex;flex-wrap:wrap;align-items:center;gap:${px(space[3])}}
.row.center{justify-content:center}
.row.end{justify-content:flex-end}
.spread{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:${px(space[4])}}
.divider{height:1px;border:0;margin:0;background:${c('border-subtle')}}
.muted{color:${c('text-secondary')}}
.faint{color:${c('text-tertiary')}}
.small{${font('caption')}}
.micro{${MICRO}}
.num{font-variant-numeric:tabular-nums}
.err{color:${c('danger')}}
.truncate{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.visually-hidden{position:absolute!important;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;
  clip:rect(0 0 0 0);white-space:nowrap;border:0}
.icon{flex:none}

/* motion — fade + rise + light blur; reduced motion turns all of it off */
@keyframes rise{from{opacity:0;transform:translateY(${px(motion.revealRisePx)});filter:blur(${px(motion.revealRisePx / 2)})}
  to{opacity:1;transform:none;filter:none}}
@keyframes pulse{from{transform:scale(1);opacity:.5}to{transform:scale(2.8);opacity:0}}
@keyframes shimmer{from{transform:translateX(-100%)}to{transform:translateX(100%)}}
@keyframes slide{from{transform:translateX(-100%)}to{transform:translateX(250%)}}
@keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-${px(space[1])})}}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes pop{0%{opacity:0;transform:scale(.6)}60%{opacity:1;transform:scale(1.06)}100%{transform:scale(1)}}
.reveal{animation:rise var(--reveal) var(--ease) both}
.reveal-list>*{animation:rise var(--reveal) var(--ease) both}
${staggerCss()}
@media (prefers-reduced-motion:reduce){
  *,*::before,*::after{animation-duration:1ms!important;animation-delay:0ms!important;
    animation-iteration-count:1!important;transition-duration:1ms!important;scroll-behavior:auto!important}
  .bar.running>span::after,.skeleton::after,.live .dot::after,.dot.live::after{display:none}
  .bar.indeterminate>span{width:100%;opacity:.4}
}
`;
}

/** The animated-list cascade: each of the first eight children starts one step later. */
function staggerCss(): string {
  const step = motion.fastMs / 4;
  const steps = 8;
  return [
    ...Array.from(
      { length: steps },
      (_, i) => `.reveal-list>:nth-child(${i + 2}){animation-delay:${ms(step * (i + 1))}}`,
    ),
    `.reveal-list>:nth-child(n+${steps + 2}){animation-delay:${ms(step * (steps + 1))}}`,
  ].join('\n');
}
