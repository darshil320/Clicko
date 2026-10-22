import { colourEntries, layout, radius, space, typography } from '@clickco/design-tokens';

const px = (n: number) => `${n}px`;
const v = (name: string) => `var(--color-${name})`;

/** Console stylesheet generated from design tokens. Replaced by @clickco/ui-web (shadcn) in S9. */
export function consoleCss(): string {
  const t = typography.scale;
  const vars = colourEntries()
    .map(([name, value]) => `--color-${name}:${value};`)
    .join('');
  return `
:root{${vars}}
*{box-sizing:border-box}
body{margin:0;background:${v('surface-base')};color:${v('text-primary')};
  font-family:${typography.family.body},system-ui,sans-serif;font-size:${px(t.body.size)};line-height:${px(t.body.lineHeight)}}
.shell{display:grid;grid-template-columns:220px 1fr;min-height:100vh}
aside{background:${v('surface-raised')};border-right:1px solid ${v('border-subtle')};padding:${px(space[5])}}
aside .brand{color:${v('accent-default')};font-weight:700;font-size:${px(t.h3.size)};display:block;margin-bottom:${px(space[6])}}
aside a{display:block;color:${v('text-secondary')};text-decoration:none;padding:${px(space[2])} ${px(space[3])};border-radius:${px(radius.sm)}}
aside a:hover{background:${v('surface-overlay')};color:${v('text-primary')}}
aside .section{color:${v('text-tertiary')};font-size:${px(t.micro.size)};text-transform:uppercase;letter-spacing:.06em;margin:${px(space[5])} 0 ${px(space[2])}}
main{padding:${px(space[8])} ${px(space[10])};max-width:1100px}
h1{font-size:${px(t.h1.size)};line-height:${px(t.h1.lineHeight)};margin:0 0 ${px(space[2])}}
h2{font-size:${px(t.h3.size)};margin:${px(space[6])} 0 ${px(space[3])}}
.muted{color:${v('text-secondary')}}
.card{background:${v('surface-raised')};border:1px solid ${v('border-subtle')};border-radius:${px(radius.lg)};padding:${px(layout.cardPadding)};margin-bottom:${px(layout.cardGap)}}
.grid{display:grid;gap:${px(space[3])};grid-template-columns:repeat(auto-fill,minmax(220px,1fr))}
label{display:flex;flex-direction:column;gap:${px(space[1])};font-size:${px(t.caption.size)};color:${v('text-secondary')}}
input,select{background:${v('surface-overlay')};color:${v('text-primary')};border:1px solid ${v('border-strong')};
  border-radius:${px(radius.md)};height:40px;padding:0 ${px(space[3])};font:inherit}
button{background:${v('accent-default')};color:${v('text-on-accent')};border:0;border-radius:${px(radius.md)};
  height:40px;padding:0 ${px(space[5])};font-weight:600;cursor:pointer}
button:disabled{opacity:.5;cursor:wait}
table{width:100%;border-collapse:collapse}
td,th{padding:${px(space[2])} ${px(space[3])};border-bottom:1px solid ${v('border-subtle')};text-align:left}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
tr.total td{font-weight:700;border-top:1px solid ${v('border-strong')}}
.pill{display:inline-block;padding:2px ${px(space[2])};border-radius:${px(radius.full)};font-size:${px(t.micro.size)};font-weight:600;letter-spacing:.04em}
.ok{background:${v('success')};color:${v('surface-base')}}
.warn{background:${v('warning')};color:${v('surface-base')}}
.bad{background:${v('danger')};color:${v('text-primary')}}
.idle{background:${v('surface-overlay')};color:${v('text-secondary')}}
.err{color:${v('danger')}}
code{background:${v('surface-overlay')};padding:1px ${px(space[1])};border-radius:${px(radius.sm)}}
`;
}
