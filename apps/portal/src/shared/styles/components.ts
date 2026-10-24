import {
  bp,
  c,
  FONT_DISPLAY,
  font,
  icon,
  layout,
  MICRO,
  motion,
  ms,
  px,
  radius,
  space,
  up,
} from './vars';

const BTN = ':is(button,.button)';
const HOVER = ':hover:not(:disabled)';
const half = (n: number) => px(n / 2);

/** Buttons, fields, cards, pills, callouts, progress bars, stats, tiles, loaders, dot pattern. */
export function componentCss(): string {
  return [buttonCss(), fieldCss(), surfaceCss(), feedbackCss(), progressCss(), decorCss()].join('');
}

/** Primary = the one amber fill in view (DESIGN.md: never more than one accent element). */
function buttonCss(): string {
  return `
${BTN}{appearance:none;display:inline-flex;align-items:center;justify-content:center;gap:${px(space[2])};
  height:${px(layout.buttonHeight)};padding:0 ${px(space[6])};border:1px solid transparent;border-radius:${px(radius.md)};
  background:${c('accent-default')};color:${c('text-on-accent')};box-shadow:var(--shadow-sm);
  font:inherit;font-weight:600;white-space:nowrap;text-decoration:none;cursor:pointer;
  transition:background-color var(--fast) var(--ease),border-color var(--fast) var(--ease),
    color var(--fast) var(--ease),box-shadow var(--fast) var(--ease),transform var(--fast) var(--ease)}
${BTN}${HOVER}{background:${c('accent-hover')};box-shadow:var(--shadow-md)}
${BTN}:active:not(:disabled){transform:translateY(1px)}
${BTN}:disabled{opacity:.5;cursor:not-allowed;box-shadow:none}
${BTN}:has(input:focus-visible){outline:2px solid ${c('text-primary')};outline-offset:2px}
${BTN}.secondary{background:${c('surface-base')};color:${c('text-primary')};border-color:${c('border-strong')}}
${BTN}.secondary${HOVER}{background:${c('surface-raised')};border-color:${c('text-tertiary')}}
${BTN}.ghost{background:transparent;color:${c('text-secondary')};box-shadow:none}
${BTN}.ghost${HOVER}{background:${c('surface-raised')};color:${c('text-primary')};box-shadow:none}
${BTN}.danger{background:${c('surface-base')};color:var(--ink-danger);border-color:var(--edge-danger)}
${BTN}.danger${HOVER}{background:var(--tint-danger);border-color:${c('danger')}}
${BTN}.sm{height:${px(layout.minTapTarget)};padding:0 ${px(space[4])}}
${BTN}.block{width:100%}
${BTN}.back{align-self:flex-start;margin-left:-${px(space[3])};padding:0 ${px(space[3])}}
${BTN}.link{height:auto;min-height:${px(layout.minTapTarget)};padding:0 ${px(space[1])};background:none;box-shadow:none;
  color:${c('text-primary')};font-weight:500;text-decoration:underline;text-underline-offset:${px(space[1])};
  text-decoration-color:${c('border-strong')}}
${BTN}.link${HOVER}{background:none;box-shadow:none;text-decoration-color:${c('text-primary')}}
`;
}

function fieldCss(): string {
  return `
.field{display:flex;flex-direction:column;gap:${px(space[2])};${font('caption')};font-weight:500;color:${c('text-primary')}}
.hint{${font('caption')};font-weight:400;color:${c('text-secondary')}}
input{width:100%;height:${px(layout.inputHeight)};padding:0 ${px(space[4])};border:1px solid ${c('border-strong')};
  border-radius:${px(radius.md)};background:${c('surface-overlay')};color:${c('text-primary')};box-shadow:var(--shadow-sm);
  font:inherit;font-variant-numeric:tabular-nums;
  transition:border-color var(--fast) var(--ease),box-shadow var(--fast) var(--ease)}
input::placeholder{color:${c('text-tertiary')}}
input:hover{border-color:${c('text-tertiary')}}
input:focus{outline:none;border-color:${c('text-primary')};
  box-shadow:0 0 0 1px ${c('text-primary')},0 0 0 ${px(space[1] + 1)} ${c('accent-subtle')}}
input.short{max-width:${px(space[14] * 3)}}
`;
}

function surfaceCss(): string {
  return `
.card{position:relative;padding:${px(space[5])};border:1px solid ${c('border-subtle')};border-radius:${px(radius.lg)};
  background:${c('surface-raised')};box-shadow:var(--shadow-sm)}
${up(bp.sm, `.card{padding:${px(space[6])}}`)}
.card.white{background:${c('surface-base')}}
.card.lift{transition:transform var(--fast) var(--ease),box-shadow var(--fast) var(--ease),border-color var(--fast) var(--ease)}
.card.lift:hover{transform:translateY(-${half(space[1])});box-shadow:var(--shadow-md);border-color:${c('border-strong')}}
.chip{display:inline-flex;align-items:center;gap:${px(space[1])};padding:${px(space[1])} ${px(space[3])};
  border:1px solid ${c('border-subtle')};border-radius:${px(radius.full)};background:${c('surface-base')};
  ${font('caption')};color:${c('text-secondary')};font-variant-numeric:tabular-nums;white-space:nowrap}
.chip strong{color:${c('text-primary')}}
.tile{display:grid;place-items:center;flex:none;width:${px(space[10])};height:${px(space[10])};
  border:1px solid ${c('border-subtle')};border-radius:${px(radius.md)};background:${c('surface-base')};
  color:${c('text-primary')};box-shadow:var(--shadow-sm)}
.tile.lg{width:${px(space[14])};height:${px(space[14])};border-radius:${px(radius.lg)}}
.tile.round{border-radius:${px(radius.full)}}
.tile.accent{background:${c('accent-subtle')};border-color:var(--edge-accent);color:${c('text-on-accent')}}
.tile.ok{background:var(--tint-success);border-color:var(--edge-success);color:var(--ink-success)}
.tile.warn{background:var(--tint-warning);border-color:var(--edge-warning);color:var(--ink-warning)}
.icon.lg{width:${px(icon.size + space[2])};height:${px(icon.size + space[2])}}
.icon.sm{width:${px(icon.size - space[1])};height:${px(icon.size - space[1])}}
`;
}

/** Status pills (tinted background + deepened text, a dot and a label: never colour alone). */
function feedbackCss(): string {
  const tones = [
    ['ok', 'success'],
    ['warn', 'warning'],
    ['bad', 'danger'],
  ] as const;
  const toned = tones
    .map(
      ([tone, s]) =>
        `.pill.${tone}{background:var(--tint-${s});color:var(--ink-${s});border-color:var(--edge-${s})}` +
        `.callout.${tone}{background:var(--tint-${s});border-color:var(--edge-${s})}` +
        `.callout.${tone} .icon{color:var(--ink-${s})}`,
    )
    .join('\n');
  return `
.pill{display:inline-flex;align-items:center;gap:${half(space[3])};flex:none;padding:${px(space[1])} ${px(space[3])};
  border:1px solid ${c('border-subtle')};border-radius:${px(radius.full)};background:${c('surface-base')};
  color:${c('text-secondary')};${MICRO};white-space:nowrap}
.dot{position:relative;display:inline-block;flex:none;width:${half(space[3])};height:${half(space[3])};
  border-radius:${px(radius.full)};background:currentColor}
.live .dot::after,.dot.live::after{content:'';position:absolute;inset:0;border-radius:inherit;background:inherit;
  animation:pulse ${ms(motion.heroMs * 3)} var(--ease) infinite}
.callout{display:flex;align-items:flex-start;gap:${px(space[3])};padding:${px(space[4])} ${px(space[5])};
  border:1px solid ${c('border-subtle')};border-radius:${px(radius.md)};background:${c('surface-raised')};color:${c('text-primary')}}
.callout .icon{color:${c('text-secondary')}}
.callout>div{display:flex;flex-direction:column;gap:${px(space[1])};min-width:0;flex:1}
.callout.accent{background:${c('accent-subtle')};border-color:var(--edge-accent)}
.callout.accent .icon{color:${c('text-on-accent')}}
${toned}
`;
}

function progressCss(): string {
  return `
.bar{position:relative;height:${px(space[3])};border-radius:${px(radius.full)};background:${c('border-subtle')};overflow:hidden}
.bar.thin{height:${half(space[3])}}
.bar>span{position:relative;display:block;height:100%;border-radius:inherit;overflow:hidden;
  background:${c('accent-default')};transition:width var(--reveal) var(--ease),background-color var(--reveal) var(--ease)}
.bar.running>span::after{content:'';position:absolute;inset:0;
  background:linear-gradient(90deg,transparent,color-mix(in srgb,${c('surface-base')} 55%,transparent),transparent);
  animation:shimmer ${ms(motion.heroMs * 3)} ease-in-out infinite}
.bar.paused>span{background:${c('text-tertiary')}}
.bar.neutral>span{background:${c('text-secondary')}}
.bar.indeterminate>span{width:40%;background:${c('text-tertiary')};animation:slide ${ms(motion.heroMs * 2)} ease-in-out infinite}
.stats{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:${px(space[3])}}
${up(bp.sm, '.stats{grid-template-columns:repeat(4,minmax(0,1fr))}')}
.stat{display:flex;flex-direction:column;gap:${px(space[1])};min-width:0;padding:${px(space[4])};
  border:1px solid ${c('border-subtle')};border-radius:${px(radius.md)};background:${c('surface-base')}}
.stat-label{${MICRO};color:${c('text-tertiary')}}
.stat-value{font-family:${FONT_DISPLAY};${font('h2')};font-weight:600;font-variant-numeric:tabular-nums;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.stat-sub{${font('caption')};color:${c('text-secondary')};font-variant-numeric:tabular-nums}
`;
}

function decorCss(): string {
  return `
.spinner{display:inline-block;flex:none;width:${px(space[5])};height:${px(space[5])};border-radius:${px(radius.full)};
  border:2px solid ${c('border-strong')};border-top-color:${c('text-primary')};animation:spin ${ms(motion.heroMs + motion.revealMs)} linear infinite}
.loading{display:flex;align-items:center;justify-content:center;gap:${px(space[3])};padding:${px(space[14])} 0;color:${c('text-secondary')}}
.skeleton{position:relative;overflow:hidden;border-radius:${px(radius.sm)};background:${c('border-subtle')}}
.skeleton::after{content:'';position:absolute;inset:0;transform:translateX(-100%);
  background:linear-gradient(90deg,transparent,color-mix(in srgb,${c('surface-base')} 70%,transparent),transparent);
  animation:shimmer ${ms(motion.heroMs * 2)} ease-in-out infinite}
.sk-title{height:${px(space[5])};width:40%}
.sk-line{height:${px(space[3])};width:70%}
.sk-short{height:${px(space[3])};width:30%}
.dots{background-image:radial-gradient(${c('border-strong')} 1px,transparent 1.5px);background-size:${px(space[5])} ${px(space[5])}}
.fade-mask{-webkit-mask-image:radial-gradient(ellipse at center,${c('text-primary')} 20%,transparent 72%);
  mask-image:radial-gradient(ellipse at center,${c('text-primary')} 20%,transparent 72%)}
.empty{display:flex;flex-direction:column;align-items:center;gap:${px(space[4])};text-align:center;
  padding:${px(space[14])} ${px(space[6])}}
.empty-art{position:relative;display:grid;place-items:center;width:${px(space[14] * 2)};height:${px(space[14] * 2)}}
.art-dots{position:absolute;inset:0;pointer-events:none}
.empty .lede{max-width:${px(space[14] * 7)}}
`;
}
