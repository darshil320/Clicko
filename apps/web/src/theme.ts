import { colourEntries, layout, radius, space, typography } from '@clickco/design-tokens';

const px = (n: number) => `${n}px`;
const v = (name: string) => `var(--color-${name})`;

/** Site stylesheet generated from design tokens, so no raw values live in the app. */
export function siteCss(): string {
  const t = typography.scale;
  const vars = colourEntries()
    .map(([name, value]) => `--color-${name}:${value};`)
    .join('');
  return `
:root{${vars}}
*{box-sizing:border-box}
body{margin:0;background:${v('surface-base')};color:${v('text-primary')};
  font-family:${typography.family.body},${typography.family.indicFallback.join(',')},sans-serif;
  font-size:${px(t.body.size)};line-height:${px(t.body.lineHeight)}}
main{max-width:760px;margin:0 auto;padding:${px(space[10])} ${px(layout.screenPaddingX)}}
nav{display:flex;flex-wrap:wrap;gap:${px(space[4])};padding:${px(space[4])} ${px(layout.screenPaddingX)};
  border-bottom:1px solid ${v('border-subtle')};background:${v('surface-raised')}}
nav a{color:${v('text-secondary')};text-decoration:none}
nav a.brand{color:${v('accent-default')};font-weight:${t.h3.weight}}
h1{font-family:${typography.family.display};font-size:${px(t.h1.size)};line-height:${px(t.h1.lineHeight)}}
h2{font-size:${px(t.h2.size)};line-height:${px(t.h2.lineHeight)};margin-top:${px(space[8])}}
a{color:${v('accent-default')}}
hr{border:0;border-top:1px solid ${v('border-subtle')};margin:${px(space[6])} 0}
table{border-collapse:collapse;width:100%}
th,td{border:1px solid ${v('border-subtle')};padding:${px(space[2])} ${px(space[3])};text-align:left}
.draft{background:${v('accent-subtle')};border:1px solid ${v('border-strong')};border-radius:${px(radius.md)};
  padding:${px(space[3])} ${px(space[4])};font-size:${px(t.caption.size)};color:${v('text-secondary')}}
footer{color:${v('text-tertiary')};font-size:${px(t.caption.size)};padding:${px(space[8])} ${px(layout.screenPaddingX)};
  text-align:center;border-top:1px solid ${v('border-subtle')}}
`;
}
