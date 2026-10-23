import {
  bp,
  fontDisplay,
  hairline,
  L,
  measure,
  micro,
  mq,
  px,
  R,
  S,
  stroke,
  T,
  type,
  v,
} from './tokens';

/** Viewfinder corner brackets drawn with gradients — no image, no extra elements. */
function viewfinderCorners(colour: string): string {
  const arm = px(S[6]);
  const w = px(stroke.thick);
  const line = `linear-gradient(${v(colour)},${v(colour)})`;
  const corners = ['left top', 'right top', 'left bottom', 'right bottom'];
  return corners
    .flatMap((at) => [`${line} ${at}/${arm} ${w} no-repeat`, `${line} ${at}/${w} ${arm} no-repeat`])
    .join(',');
}

/** Hero, quote preview, steps, waitlist form, store badges. */
export function sectionsCss(): string {
  return `
.facts{display:flex;flex-wrap:wrap;gap:${px(S[2])} ${px(S[5])};list-style:none;margin:${px(S[8])} 0 0;
  padding:0;color:${v('text-secondary')};${type(T.caption)}}
.facts strong{display:block;color:${v('text-primary')};${type(T.bodyStrong)};font-variant-numeric:tabular-nums}
.viewfinder{position:relative;margin:0;padding:${px(S[8])} ${px(S[6])};background:${viewfinderCorners('border-strong')}}
.viewfinder-label{${micro};color:${v('text-secondary')};display:flex;justify-content:space-between;
  margin:0 0 ${px(S[3])}}
.quote{background:${v('surface-raised')};border:${hairline()};border-radius:${px(R.lg)};padding:${px(S[5])}}
.quote h2{${micro};color:${v('text-secondary')};font-family:inherit;margin:0 0 ${px(S[3])}}
.quote dl{margin:0;display:grid;gap:0}
.quote-row{display:flex;justify-content:space-between;gap:${px(S[4])};padding:${px(S[2])} 0;border-bottom:${hairline()};
  font-variant-numeric:tabular-nums}
.quote-row dt{color:${v('text-secondary')}}
.quote-row dd{margin:0;text-align:right}
.quote-sum{border-bottom:0;padding-top:${px(S[3])}}
.quote-sum dt{color:${v('text-primary')};${type(T.bodyStrong)}}
.quote-sum dd{font-family:${fontDisplay};${type(T.h1)}}
.quote-meta{margin:${px(S[3])} 0 0;color:${v('text-secondary')};${type(T.caption)}}
.steps{counter-reset:step}
.step-num{display:inline-flex;align-items:center;justify-content:center;width:${px(S[8])};height:${px(S[8])};
  margin-bottom:${px(S[3])};border:${hairline('border-strong')};border-radius:${px(R.full)};
  ${type(T.bodyStrong)};font-variant-numeric:tabular-nums}
.band dl{display:grid;gap:${px(S[3])};margin:0}
.band dt{${micro};color:${v('text-secondary')};margin-bottom:${px(S[1])}}
.band dd{margin:0}
.factor-list{display:grid;gap:${px(S[2])};margin:0;padding:0;list-style:none}
.factor-list li{display:flex;justify-content:space-between;gap:${px(S[4])};padding:${px(S[2])} 0;
  border-bottom:${hairline()};font-variant-numeric:tabular-nums}
.factor-list li span:last-child{color:${v('text-secondary')};text-align:right}
.form{display:grid;gap:${px(S[5])}}
.form-row{display:grid;gap:${px(S[5])}}
${mq(bp.sm)}{.form-row{grid-template-columns:repeat(2,minmax(0,1fr))}}
.field{display:grid;gap:${px(S[2])};align-content:start}
.field label{${type(T.bodyStrong)}}
.field .hint{${type(T.caption)};color:${v('text-secondary')};margin:0}
.input{width:100%;height:${px(L.inputHeight)};padding:0 ${px(S[4])};background:${v('surface-raised')};
  border:${hairline('border-strong')};border-radius:${px(R.md)};color:${v('text-primary')};font:inherit;
  color-scheme:dark}
.input:focus-visible{outline:${px(stroke.thick)} solid ${v('accent-default')};outline-offset:0;
  border-color:${v('accent-default')}}
.input[aria-invalid="true"]{border-color:${v('danger')}}
.input-group{display:flex}
.input-group .prefix{display:inline-flex;align-items:center;padding:0 ${px(S[3])};background:${v('surface-overlay')};
  border:${hairline('border-strong')};border-right:0;border-radius:${px(R.md)} 0 0 ${px(R.md)};color:${v('text-secondary')}}
.input-group .input{border-radius:0 ${px(R.md)} ${px(R.md)} 0}
.field-error{${type(T.caption)};color:${v('danger')};margin:0}
.form-consent{${type(T.caption)};color:${v('text-secondary')};margin:0}
.store-badges{display:flex;flex-wrap:wrap;gap:${px(S[3])};margin:${px(S[6])} 0 0;padding:0;list-style:none}
.store-badge{display:inline-flex;flex-direction:column;justify-content:center;min-height:${px(L.buttonHeight)};
  padding:${px(S[2])} ${px(S[5])};border:${hairline('border-strong')};border-radius:${px(R.md)};
  background:${v('surface-raised')};${type(T.bodyStrong)}}
.store-badge small{${micro};color:${v('text-secondary')}}
.split{display:grid;gap:${px(S[8])}}
.split-gap{margin-top:${px(S[10])}}
${mq(bp.lg)}{.split{grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:${px(S[14])}}}
.prose-block{max-width:${px(measure.prose)}}
`;
}
