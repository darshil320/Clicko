import { colourEntries } from '@clickco/design-tokens';
import {
  fontBody,
  fontDisplay,
  hairline,
  L,
  measure,
  micro,
  px,
  R,
  S,
  stroke,
  T,
  type,
  v,
} from './tokens';

/** Reset, typography, focus, legal-page prose. Every value comes from tokens.ts. */
export function baseCss(): string {
  const vars = colourEntries()
    .map(([name, value]) => `--color-${name}:${value};`)
    .join('');
  return `
:root{${vars}color-scheme:dark}
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
@media (prefers-reduced-motion:no-preference){html{scroll-behavior:smooth}}
body{margin:0;background:${v('surface-base')};color:${v('text-primary')};font-family:${fontBody};
  ${type(T.body)};-webkit-font-smoothing:antialiased}
h1,h2,h3{font-family:${fontDisplay};margin:0 0 ${px(S[3])}}
h1{${type(T.h1)}}
h2{${type(T.h2)}}
h3{${type(T.h3)}}
p{margin:0 0 ${px(S[4])}}
ul,ol{margin:0 0 ${px(S[4])};padding-left:${px(S[5])}}
img{display:block;max-width:100%;height:auto}
a{color:${v('text-primary')};text-decoration:underline;text-decoration-color:${v('accent-default')};
  text-underline-offset:${px(S[1])}}
a:hover{color:${v('accent-hover')}}
:focus-visible{outline:${px(stroke.thick)} solid ${v('accent-default')};outline-offset:${px(stroke.thick)};
  border-radius:${px(R.sm)}}
.skip-link{position:absolute;left:${px(S[4])};top:${px(-S[14])};z-index:20;padding:${px(S[3])} ${px(S[4])};
  background:${v('surface-overlay')};border:${hairline('border-strong')};border-radius:${px(R.md)}}
.skip-link:focus{top:${px(S[4])}}
main:focus{outline:none}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;
  clip:rect(0,0,0,0);white-space:nowrap;border:0}
hr{border:0;border-top:${hairline()};margin:${px(S[6])} 0}
table{border-collapse:collapse;width:100%}
th,td{border:${hairline()};padding:${px(S[2])} ${px(S[3])};text-align:left;vertical-align:top}
.draft{background:${v('accent-subtle')};border:${hairline('border-strong')};border-radius:${px(R.md)};
  padding:${px(S[3])} ${px(S[4])};${type(T.caption)};color:${v('text-secondary')}}
main>:not(.page){max-width:${px(measure.prose)};margin-left:auto;margin-right:auto;
  padding-left:${px(L.screenPaddingX)};padding-right:${px(L.screenPaddingX)}}
main>:not(.page):first-child{margin-top:${px(S[10])}}
main>:not(.page):last-child{margin-bottom:${px(S[14])}}
.eyebrow{${micro};color:${v('text-secondary')};margin:0 0 ${px(S[2])}}
.muted{color:${v('text-secondary')}}
.num{font-variant-numeric:tabular-nums}
`;
}
