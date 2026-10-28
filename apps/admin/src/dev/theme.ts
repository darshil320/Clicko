import {
  colorLight,
  colourEntries,
  layout,
  radius,
  space,
  typography,
} from '@clickco/design-tokens';

const px = (n: number) => `${n}px`;
const v = (name: string) => `var(--color-${name})`;

/**
 * The developer simulators' stylesheet (/dev/*, development only), generated from design tokens.
 * Scoped under `.dev-console` so it never leaks into the staff panel, and on the white theme
 * (ADR-0025 D6: one look across Clickco's surfaces).
 */
export function consoleCss(): string {
  const t = typography.scale;
  const vars = colourEntries(colorLight)
    .map(([name, value]) => `--color-${name}:${value};`)
    .join('');
  return `
.dev-console{${vars}}
.dev-console{background:${v('surface-base')};color:${v('text-primary')};
  font-family:${typography.family.body},system-ui,sans-serif;font-size:${px(t.body.size)};line-height:${px(t.body.lineHeight)}}
.dev-console .shell{display:grid;grid-template-columns:220px 1fr;min-height:100vh}
.dev-console aside{background:${v('surface-raised')};border-right:1px solid ${v('border-subtle')};padding:${px(space[5])}}
.dev-console aside .brand{color:${v('text-primary')};font-weight:700;font-size:${px(t.h3.size)};display:block;margin-bottom:${px(space[6])}}
.dev-console aside a{display:block;color:${v('text-secondary')};text-decoration:none;padding:${px(space[2])} ${px(space[3])};border-radius:${px(radius.sm)}}
.dev-console aside a:hover{background:${v('surface-overlay')};color:${v('text-primary')}}
.dev-console aside .section{color:${v('text-tertiary')};font-size:${px(t.micro.size)};text-transform:uppercase;letter-spacing:.06em;margin:${px(space[5])} 0 ${px(space[2])}}
.dev-console main{padding:${px(space[8])} ${px(space[10])};max-width:1100px}
.dev-console h1{font-size:${px(t.h1.size)};line-height:${px(t.h1.lineHeight)};margin:0 0 ${px(space[2])}}
.dev-console h2{font-size:${px(t.h3.size)};margin:${px(space[6])} 0 ${px(space[3])}}
.dev-console .muted{color:${v('text-secondary')}}
.dev-console .card{background:${v('surface-raised')};border:1px solid ${v('border-subtle')};border-radius:${px(radius.lg)};padding:${px(layout.cardPadding)};margin-bottom:${px(layout.cardGap)}}
.dev-console .grid{display:grid;gap:${px(space[3])};grid-template-columns:repeat(auto-fill,minmax(220px,1fr))}
.dev-console label{display:flex;flex-direction:column;gap:${px(space[1])};font-size:${px(t.caption.size)};color:${v('text-secondary')}}
.dev-console input,.dev-console select{background:${v('surface-overlay')};color:${v('text-primary')};border:1px solid ${v('border-strong')};
  border-radius:${px(radius.md)};height:40px;padding:0 ${px(space[3])};font:inherit}
.dev-console button{background:${v('accent-default')};color:${v('text-on-accent')};border:0;border-radius:${px(radius.md)};
  height:40px;padding:0 ${px(space[5])};font-weight:600;cursor:pointer}
.dev-console button:disabled{opacity:.5;cursor:wait}
.dev-console button.link{background:none;color:${v('text-primary')};height:auto;padding:0;font-weight:400;text-decoration:underline}
.dev-console table{width:100%;border-collapse:collapse}
.dev-console td,.dev-console th{padding:${px(space[2])} ${px(space[3])};border-bottom:1px solid ${v('border-subtle')};text-align:left}
.dev-console td.num,.dev-console th.num{text-align:right;font-variant-numeric:tabular-nums}
.dev-console tr.total td{font-weight:700;border-top:1px solid ${v('border-strong')}}
.dev-console .pill{display:inline-block;padding:2px ${px(space[2])};border-radius:${px(radius.full)};font-size:${px(t.micro.size)};font-weight:600;letter-spacing:.04em}
.dev-console .ok{background:${v('success')};color:${v('surface-base')}}
.dev-console .warn{background:${v('warning')};color:${v('surface-base')}}
.dev-console .bad{background:${v('danger')};color:${v('surface-base')}}
.dev-console .idle{background:${v('surface-overlay')};color:${v('text-secondary')}}
.dev-console .err{color:${v('danger')}}
.dev-console code{background:${v('surface-overlay')};padding:1px ${px(space[1])};border-radius:${px(radius.sm)}}
`;
}
