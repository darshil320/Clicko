import { colourEntries } from '@clickco/design-tokens';
import {
  bp,
  extras,
  fluid,
  fluidType,
  fontBody,
  fontDisplay,
  fx,
  hairline,
  headerOverlay,
  L,
  label,
  measure,
  mq,
  palette,
  prose,
  px,
  R,
  rhythm,
  S,
  shadow,
  shadows,
  stroke,
  T,
  tint,
  type,
  v,
  webType,
} from './tokens';

const rootVariables = (): string =>
  [
    ...colourEntries(palette).map(([name, value]) => `--color-${name}:${value};`),
    ...colourEntries(extras).map(([name, value]) => `--color-${name}:${value};`),
    ...Object.entries(shadows).map(([level, value]) => `--shadow-${level}:${value};`),
  ].join('');

/** Reset, typography, links, focus. Every value comes from tokens.ts. */
export function baseCss(): string {
  return `
:root{${rootVariables()}color-scheme:light}
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;text-rendering:optimizeLegibility}
body{margin:0;background:${v('surface-base')};color:${v('text-primary')};font-family:${fontBody};
  ${type(T.body)};-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}
h1,h2,h3{margin:0 0 ${px(S[3])};text-wrap:balance}
h1,h2{font-family:${fontDisplay};font-weight:${webType.page.weight}}
h1{${fluidType(webType.page)}}
h2{${fluidType(webType.figure)}}
h3{font-family:${fontBody};${fluidType(webType.title)}}
h1 em,h2 em{font-style:italic;color:${v('accent-text')}}
p{margin:0 0 ${px(S[4])};text-wrap:pretty}
ul,ol{margin:0 0 ${px(S[4])};padding-left:${px(S[5])}}
img,svg{display:block;max-width:100%;height:auto}
a{color:${v('accent-text')};text-decoration:underline;text-decoration-thickness:${px(stroke.hairline)};
  text-decoration-color:${tint('accent-text', fx.linkUnderlinePercent)};text-underline-offset:${px(S[1])}}
a:hover{text-decoration-color:${v('accent-text')}}
::selection{background:${tint('accent-default', fx.selectionPercent)};color:${v('text-primary')}}
:focus-visible{outline:${px(stroke.thick)} solid ${v('text-primary')};outline-offset:${px(stroke.thick)};
  border-radius:${px(R.sm)}}
.skip-link{position:absolute;left:${px(S[4])};top:${px(-S[14])};z-index:20;padding:${px(S[3])} ${px(S[4])};
  background:${v('surface-overlay')};border:${hairline('border-strong')};border-radius:${px(R.md)}}
.skip-link:focus{top:${px(S[4])};box-shadow:${shadow('md')}}
main:focus{outline:none}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;
  clip:rect(0,0,0,0);white-space:nowrap;border:0}
hr{border:0;border-top:${hairline()};margin:${px(S[8])} 0}
table{border-collapse:collapse;width:100%}
th,td{border-bottom:${hairline()};padding:${px(S[3])} ${px(S[3])};text-align:left;vertical-align:top}
th{${type(T.bodyStrong)};color:${v('text-primary')}}
.eyebrow{${label};color:${v('text-tertiary')};margin:0 0 ${px(S[4])}}
.muted{color:${v('text-secondary')}}
.num{font-variant-numeric:tabular-nums}
${legalCss()}`;
}

/**
 * Legal pages render markdown straight into <main> (no .page wrapper): a reading column with
 * a comfortable line height and calm secondary body text (DESIGN-LIGHT §Whitespace).
 */
function legalCss(): string {
  return `
main>:not(.page){max-width:${px(measure.prose + L.screenPaddingX * 2)};margin-left:auto;margin-right:auto;
  padding-left:${px(L.screenPaddingX)};padding-right:${px(L.screenPaddingX)}}
main>:not(.page):first-child{margin-top:${px(rhythm.mobile)}}
main>:not(.page):last-child{margin-bottom:${px(rhythm.tablet)}}
${mq(bp.lg)}{
  main>:not(.page):first-child{margin-top:${px(rhythm.tablet + headerOverlay)}}
  main>:not(.page):last-child{margin-bottom:${px(rhythm.desktop)}}
}
main>:not(.page){font-size:${fluid(T.body.size, prose.size)};line-height:${prose.leading}}
main>article p,main>article li,main>p{color:${v('text-secondary')}}
main>article strong{color:${v('text-primary')}}
main>article h1,main>h1{margin-bottom:${px(S[6])}}
main>article h2{${fluidType(webType.title)};margin:${px(S[10])} 0 ${px(S[3])}}
main>article h3{${type(T.bodyStrong)};font-family:${fontBody};margin:${px(S[8])} 0 ${px(S[2])}}
main>article li+li{margin-top:${px(S[2])}}
main>article table{margin:${px(S[6])} 0;font-size:${px(T.caption.size)};line-height:${prose.leading}}
main>.draft{width:calc(100% - ${px(L.screenPaddingX * 2)});max-width:${px(measure.prose)};margin-bottom:${px(S[8])}}
main>.draft,.draft{background:${v('accent-subtle')};border:${hairline('border-strong')};border-radius:${px(R.md)};
  padding:${px(S[3])} ${px(S[4])};${type(T.caption)};color:${v('text-secondary')}}
`;
}
