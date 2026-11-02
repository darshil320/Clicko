import { bp, hairline, ICON, L, measure, mq, px, R, S, T, type, v } from './tokens';

/**
 * The delivery page (/d/<token>, ADR-0027 D6c). Phone first: most clients open it from WhatsApp.
 * On a phone each file's name takes the card's full width, with its size and a full-size download
 * button below; from tablet up the button sits beside the name. Long camera names wrap.
 */
export function deliveryCss(): string {
  return `
.delivery-files{display:grid;gap:${px(S[3])};list-style:none;margin:${px(S[8])} 0 0;padding:0;
  max-width:${px(measure.prose)}}
.delivery-file{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;
  column-gap:${px(S[4])};row-gap:${px(S[2])};background:${v('surface-overlay')};border:${hairline()};
  border-radius:${px(R.lg)};padding:${px(S[4])}}
.delivery-file-name{grid-column:1/-1;${type(T.bodyStrong)};margin:0;overflow-wrap:anywhere}
.delivery-file-size{grid-column:1;${type(T.caption)};color:${v('text-secondary')};margin:0;
  font-variant-numeric:tabular-nums}
.delivery-file .btn{grid-column:2;min-width:${px(L.minTapTarget)}}
.delivery-file .btn svg{width:${px(ICON.size - S[1])};height:${px(ICON.size - S[1])}}
.delivery-note{max-width:${px(measure.prose)}}
.delivery-status:focus{outline:none}
${mq(bp.sm)}{
  .delivery-file{row-gap:0;padding:${px(S[4])} ${px(S[5])}}
  .delivery-file-name{grid-column:1;grid-row:1}
  .delivery-file-size{grid-row:2}
  .delivery-file .btn{grid-row:1/span 2}
}
`;
}
