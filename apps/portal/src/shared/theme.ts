import { colourEntries, layout, radius, space, typography } from '@clickco/design-tokens';

const px = (n: number) => `${n}px`;
const v = (name: string) => `var(--color-${name})`;

/**
 * Portal stylesheet generated from design tokens — no raw colours anywhere else. Moves to
 * @clickco/ui-web (shadcn) with the admin rebuild in S9, as the console does.
 */
export function portalCss(): string {
  const t = typography.scale;
  const vars = colourEntries()
    .map(([name, value]) => `--color-${name}:${value};`)
    .join('');
  return `
:root{${vars}}
*{box-sizing:border-box}
body{margin:0;background:${v('surface-base')};color:${v('text-primary')};
  font-family:${typography.family.body},system-ui,sans-serif;font-size:${px(t.body.size)};line-height:${px(t.body.lineHeight)}}
header.top{display:flex;align-items:center;justify-content:space-between;padding:${px(space[4])} ${px(space[8])};
  border-bottom:1px solid ${v('border-subtle')};background:${v('surface-raised')}}
header.top .brand{color:${v('accent-default')};font-weight:700;font-size:${px(t.h3.size)};text-decoration:none}
header.top nav{display:flex;gap:${px(space[4])};align-items:center}
header.top a{color:${v('text-secondary')};text-decoration:none}
/* a single-form card (sign-in) */
.narrow{max-width:420px}
main{padding:${px(space[8])} ${px(space[8])};max-width:1040px;margin:0 auto}
h1{font-size:${px(t.h1.size)};line-height:${px(t.h1.lineHeight)};margin:0 0 ${px(space[2])}}
h2{font-size:${px(t.h3.size)};margin:${px(space[6])} 0 ${px(space[3])}}
.muted{color:${v('text-secondary')}}
.small{font-size:${px(t.caption.size)};line-height:${px(t.caption.lineHeight)}}
.card{background:${v('surface-raised')};border:1px solid ${v('border-subtle')};border-radius:${px(radius.lg)};
  padding:${px(layout.cardPadding)};margin-bottom:${px(layout.cardGap)}}
.row{display:flex;gap:${px(space[3])};align-items:center;flex-wrap:wrap}
.spread{display:flex;justify-content:space-between;align-items:center;gap:${px(space[3])};flex-wrap:wrap}
.stack{display:flex;flex-direction:column;gap:${px(space[3])}}
.row.center{justify-content:center}
.align-end{text-align:right;align-items:flex-end}
label{display:flex;flex-direction:column;gap:${px(space[1])};font-size:${px(t.caption.size)};color:${v('text-secondary')}}
input{background:${v('surface-overlay')};color:${v('text-primary')};border:1px solid ${v('border-strong')};
  border-radius:${px(radius.md)};height:44px;padding:0 ${px(space[3])};font:inherit}
button,.button{display:inline-flex;align-items:center;justify-content:center;background:${v('accent-default')};
  color:${v('text-on-accent')};border:0;border-radius:${px(radius.md)};height:44px;padding:0 ${px(space[5])};
  font:inherit;font-weight:600;cursor:pointer;text-decoration:none}
button:disabled{opacity:.5;cursor:not-allowed}
button.secondary,.button.secondary{background:${v('surface-overlay')};color:${v('text-primary')};border:1px solid ${v('border-strong')}}
button.danger{background:${v('danger')};color:${v('text-primary')}}
button.link{background:none;color:${v('accent-default')};height:auto;padding:0;font-weight:400;text-decoration:underline}
.pill{display:inline-block;padding:2px ${px(space[2])};border-radius:${px(radius.full)};font-size:${px(t.micro.size)};
  font-weight:600;letter-spacing:${typography.microTrackingEm}em;text-transform:uppercase}
.ok{background:${v('success')};color:${v('surface-base')}}
.warn{background:${v('warning')};color:${v('surface-base')}}
.bad{background:${v('danger')};color:${v('text-primary')}}
.idle{background:${v('surface-overlay')};color:${v('text-secondary')}}
.err{color:${v('danger')}}
.warn-text{color:${v('warning')}}
.overdue{color:${v('danger')};font-weight:600}
.countdown{font-variant-numeric:tabular-nums;font-weight:600}
.drop{border:2px dashed ${v('border-strong')};border-radius:${px(radius.lg)};padding:${px(space[10])};text-align:center;
  background:${v('surface-raised')};color:${v('text-secondary')}}
.drop.active{border-color:${v('accent-default')};color:${v('text-primary')}}
.bar{height:10px;border-radius:${px(radius.full)};background:${v('surface-overlay')};overflow:hidden}
.bar>span{display:block;height:100%;background:${v('accent-default')}}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:${px(space[3])}}
.stat .value{font-size:${px(t.h2.size)};font-weight:700;font-variant-numeric:tabular-nums}
ul.plain{list-style:none;padding:0;margin:0}
ul.plain li{padding:${px(space[1])} 0;border-bottom:1px solid ${v('border-subtle')}}
code{background:${v('surface-overlay')};padding:1px ${px(space[1])};border-radius:${px(radius.sm)}}
`;
}
