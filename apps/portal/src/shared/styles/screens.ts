import {
  below,
  bp,
  c,
  column,
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

const half = (n: number) => px(n / 2);

/** Screen-level pieces: sign-in, job cards, the drop zone and file list, upload progress, timeline. */
export function screenCss(): string {
  return [authCss(), jobsCss(), dropCss(), progressCss(), timelineCss()].join('');
}

function authCss(): string {
  return `
.auth{position:relative;isolation:isolate;display:grid;place-items:center;min-height:70vh;padding:${px(space[6])} 0}
.auth-bg{position:absolute;z-index:-1;inset:-${px(space[10])} -${px(space[5])};pointer-events:none}
.auth-card{width:100%;max-width:${px(column.form)};padding:${px(space[8])} ${px(space[6])};
  border:1px solid ${c('border-subtle')};border-radius:${px(radius.lg)};background:${c('surface-base')};box-shadow:var(--shadow-lg)}
${up(bp.sm, `.auth-card{padding:${px(space[10])}}`)}
.auth-head{display:flex;flex-direction:column;gap:${px(space[2])};margin:${px(space[6])} 0 ${px(space[8])}}
.auth-head h1{${font('h1')}}
.steps{display:flex;gap:${px(space[1])};margin-bottom:${px(space[2])}}
.steps span{flex:1;height:${px(space[1])};border-radius:${px(radius.full)};background:${c('border-subtle')};
  transition:background-color var(--reveal) var(--ease)}
.steps span.on{background:${c('text-primary')}}
.auth-error{margin-top:${px(space[5])}}
.otp{font-family:${FONT_DISPLAY};${font('h2')};font-weight:600;letter-spacing:${px(space[2])};text-align:center}
.auth-foot{margin-top:${px(space[6])};padding-top:${px(space[5])};border-top:1px solid ${c('border-subtle')};
  display:flex;gap:${px(space[2])};align-items:flex-start;color:${c('text-tertiary')};${font('caption')}}
`;
}

function jobsCss(): string {
  return `
.groups{display:flex;flex-direction:column;gap:${px(space[10])}}
.group{display:flex;flex-direction:column;gap:${px(space[4])}}
.group-label{display:flex;align-items:center;gap:${px(space[2])};${MICRO};color:${c('text-tertiary')}}
.count{display:inline-grid;place-items:center;min-width:${px(space[5])};height:${px(space[5])};padding:0 ${half(space[3])};
  border-radius:${px(radius.full)};background:${c('surface-raised')};border:1px solid ${c('border-subtle')};
  color:${c('text-secondary')};letter-spacing:0}
.job{display:flex;flex-direction:column;gap:${px(space[5])}}
.job-head{display:flex;align-items:flex-start;justify-content:space-between;gap:${px(space[4])}}
.job-head>div{display:flex;flex-direction:column;gap:${px(space[2])};min-width:0}
.ref{font-family:${FONT_DISPLAY};${font('h3')};font-weight:600;font-variant-numeric:tabular-nums}
.meta{display:flex;flex-wrap:wrap;align-items:center;gap:${px(space[2])} ${px(space[4])};${font('caption')};color:${c('text-secondary')}}
.meta>span{display:inline-flex;align-items:center;gap:${half(space[3])};white-space:nowrap}
.meta .icon{color:${c('text-tertiary')}}
.job-foot{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:${px(space[4])};
  padding-top:${px(space[5])};border-top:1px solid ${c('border-subtle')}}
.job-foot>div{display:flex;flex-direction:column;gap:${px(space[1])};min-width:0;flex:1}
${below(bp.sm, '.job-foot{flex-direction:column;align-items:stretch}.job-foot>div{flex:none}.job-foot>.button{width:100%}')}
.countdown{font-family:${FONT_DISPLAY};${font('h2')};font-weight:600;font-variant-numeric:tabular-nums;color:${c('text-primary')}}
.countdown.overdue{color:${c('danger')}}
.mini{display:flex;flex-direction:column;gap:${px(space[2])};margin-top:${px(space[3])};max-width:${px(space[14] * 6)}}
.deadline-box{display:flex;flex-direction:column;gap:${px(space[1])}}
${up(bp.sm, '.deadline-box{align-items:flex-end;text-align:right}')}
`;
}

/** The drop zone: a dashed field on a faint dot pattern that brightens and pulses on drag-over. */
function dropCss(): string {
  return `
.drop{position:relative;isolation:isolate;overflow:hidden;display:flex;flex-direction:column;align-items:center;
  justify-content:center;gap:${px(space[4])};padding:${px(space[10])} ${px(space[5])};text-align:center;
  border:2px dashed ${c('border-strong')};border-radius:${px(radius.lg)};background:${c('surface-raised')};
  color:${c('text-secondary')};transition:border-color var(--fast) var(--ease),background-color var(--fast) var(--ease),
    box-shadow var(--fast) var(--ease)}
${up(bp.sm, `.drop{padding:${px(sectionSpace.mobile)} ${px(space[10])}}`)}
.drop-bg{position:absolute;z-index:-1;inset:0;pointer-events:none;opacity:.8}
.drop:hover{border-color:${c('text-tertiary')}}
.drop.active{border-color:${c('accent-default')};background:${c('accent-subtle')};
  box-shadow:0 0 0 ${px(space[1])} var(--edge-accent)}
.drop.active .formats{color:${c('text-secondary')}}
.drop-icon{position:relative;animation:float ${ms(motion.heroMs * 5)} ease-in-out infinite;
  transition:transform var(--fast) var(--ease)}
.drop-icon::after{content:'';position:absolute;inset:0;border-radius:inherit;border:2px solid ${c('accent-default')};opacity:0}
.drop.active .drop-icon{animation:none;transform:translateY(-${px(space[1])}) scale(1.06)}
.drop.active .drop-icon::after{animation:pulse ${ms(motion.heroMs * 2)} var(--ease) infinite}
.drop-title{font-family:${FONT_DISPLAY};${font('h2')};font-weight:600;color:${c('text-primary')}}
.drop .row{margin-top:${px(space[2])}}
.formats{display:flex;flex-wrap:wrap;justify-content:center;gap:${px(space[1])} ${px(space[2])};margin-top:${px(space[2])};
  ${MICRO};color:${c('text-tertiary')}}
.files{list-style:none;margin:0;padding:0;overflow:hidden;
  border:1px solid ${c('border-subtle')};border-radius:${px(radius.md)};background:${c('surface-base')}}
.files li{display:flex;align-items:center;gap:${px(space[3])};min-height:${px(layout.minTapTarget + space[2])};
  padding:${px(space[2])} ${px(space[4])};border-bottom:1px solid ${c('border-subtle')}}
.files li:last-child{border-bottom:0}
.files .more{justify-content:center;color:${c('text-secondary')};${font('caption')}}
.kind{flex:none;min-width:${px(space[10] + space[2])};padding:${half(space[1])} ${half(space[3])};text-align:center;
  border:1px solid ${c('border-subtle')};border-radius:${px(radius.sm)};background:${c('surface-raised')};
  ${MICRO};color:${c('text-secondary')}}
.kind.raw{background:${c('accent-subtle')};border-color:var(--edge-accent);color:${c('text-on-accent')}}
.file-main{display:flex;flex-direction:column;flex:1;min-width:0}
.file-sub{${font('caption')};color:${c('text-tertiary')}}
.file-size{flex:none;${font('caption')};color:${c('text-secondary')};font-variant-numeric:tabular-nums}
.file-bar{flex:none;width:${px(space[14] * 2)}}
.plain{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:${px(space[1])}}
.lead-row{display:flex;align-items:flex-start;gap:${px(space[4])}}
`;
}

function progressCss(): string {
  return `
.progress-head{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:${px(space[4])}}
.state{display:inline-flex;align-items:center;gap:${px(space[2])};font-weight:600}
.state .dot{width:${px(space[2])};height:${px(space[2])}}
.state.running .dot{color:${c('success')}}
.state.paused .dot{color:${c('text-tertiary')}}
.state.failed .dot{color:${c('danger')}}
.percent{font-family:${FONT_DISPLAY};${font('display')};font-weight:700;font-variant-numeric:tabular-nums}
.done-card{display:flex;flex-direction:column;align-items:center;gap:${px(space[4])};text-align:center;
  padding:${px(sectionSpace.mobile)} ${px(space[6])}}
.done-card .tile{animation:pop var(--hero) var(--ease) both}
.done-card .lede{max-width:${px(sectionSpace.readingMax)}}
`;
}

/** The status timeline: done nodes fill green, the current one pulses, later ones stay hollow. */
function timelineCss(): string {
  const node = space[8];
  return `
.timeline{list-style:none;margin:0;padding:0;display:flex;flex-direction:column}
.step{position:relative;display:grid;grid-template-columns:${px(node)} minmax(0,1fr) auto;gap:${px(space[4])};
  align-items:start;padding-bottom:${px(space[8])}}
.step:last-child{padding-bottom:0}
.step::before{content:'';position:absolute;left:${px(node / 2 - 1)};top:${px(node + space[1])};bottom:${px(space[1])};
  width:2px;border-radius:${px(radius.full)};background:${c('border-subtle')}}
.step:last-child::before{display:none}
.step.done::before{background:var(--edge-success)}
.node{position:relative;display:grid;place-items:center;width:${px(node)};height:${px(node)};border-radius:${px(radius.full)};
  border:2px solid ${c('border-strong')};background:${c('surface-base')};color:${c('text-tertiary')}}
.step.done .node{border-color:${c('success')};background:${c('success')};color:${c('surface-base')}}
.step.current .node{border-color:${c('warning')};color:${c('warning')}}
.node .dot{width:${px(space[2])};height:${px(space[2])}}
.step-body{display:flex;flex-direction:column;gap:${px(space[1])};padding-top:${half(space[1])}}
.step-title{font-weight:600}
`;
}
