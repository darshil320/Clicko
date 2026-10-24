import { bp, fx, hairline, L, mq, px, R, S, shadow, stroke, T, tint, type, v } from './tokens';

/** Waitlist form controls (DESIGN.md §Components: Input). */
export function formsCss(): string {
  return `
.form-card{background:${v('surface-base')};border:${hairline()};border-radius:${px(R.lg)};padding:${px(S[5])};
  box-shadow:${shadow('md')}}
${mq(bp.lg)}{.form-card{padding:${px(S[8])}}}
.form{display:grid;gap:${px(S[5])}}
.form-row{display:grid;gap:${px(S[5])}}
${mq(bp.sm)}{.form-row{grid-template-columns:repeat(2,minmax(0,1fr))}}
.field{display:grid;gap:${px(S[2])};align-content:start}
.field label{${type(T.bodyStrong)}}
.field .hint{${type(T.caption)};color:${v('text-secondary')};margin:0}
.input{width:100%;height:${px(L.inputHeight)};padding:0 ${px(S[4])};background:${v('surface-base')};
  border:${hairline('border-strong')};border-radius:${px(R.md)};color:${v('text-primary')};font:inherit;
  color-scheme:light;box-shadow:${shadow('sm')}}
.input::placeholder{color:${v('text-tertiary')}}
.input:hover{border-color:${v('text-tertiary')}}
.input:focus-visible{outline:${px(stroke.thick)} solid ${v('text-primary')};outline-offset:0;
  border-color:${v('text-primary')};box-shadow:0 0 0 ${px(S[1] + stroke.thick)} ${tint('accent-default', fx.focusHaloPercent)}}
.input[aria-invalid="true"]{border-color:${v('danger')}}
.input-group{display:flex}
.input-group .prefix{display:inline-flex;align-items:center;padding:0 ${px(S[3])};background:${v('surface-raised')};
  border:${hairline('border-strong')};border-right:0;border-radius:${px(R.md)} 0 0 ${px(R.md)};color:${v('text-secondary')}}
.input-group .input{border-radius:0 ${px(R.md)} ${px(R.md)} 0}
.field-error{${type(T.caption)};color:${v('danger')};margin:0}
.form-consent{${type(T.caption)};color:${v('text-secondary')};margin:0}
`;
}
