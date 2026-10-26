import {
  bp,
  fluidType,
  hairline,
  L,
  mq,
  px,
  R,
  RD,
  S,
  shadow,
  T,
  tint,
  type,
  v,
  webType,
} from './tokens';

/** The frosted plate behind the reel's pause button, as for photo captions. */
const PLATE_PERCENT = 72;

/**
 * ADR-0023: the vertical reel frame, the "moments" cards, the reels wall and the creators block.
 * Rows of cards and reels swipe sideways on phones (scroll-snap) and settle into a grid on desktop.
 */
export function momentsCss(): string {
  return [reelCss(), momentCardsCss(), reelWallCss(), creatorsCss()].join('\n');
}

/** A sideways-scrolling row that bleeds to the screen edge on phones. */
const swipeRow = (
  column: string,
): string => `display:grid;grid-auto-flow:column;grid-auto-columns:${column};
  gap:${px(S[3])};overflow-x:auto;scroll-snap-type:x mandatory;
  scrollbar-width:none;list-style:none;margin:0 ${px(-L.screenPaddingX)};
  padding:0 ${px(L.screenPaddingX)} ${px(S[2])};scroll-padding-inline:${px(L.screenPaddingX)}`;

function reelCss(): string {
  return `
.reel{position:relative;overflow:hidden;isolation:isolate;margin:0;aspect-ratio:9/16;border-radius:${px(RD.photo)};
  background:${v('surface-raised')}}
.reel video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:-1}
.reel-toggle{position:absolute;z-index:1;top:${px(S[3])};right:${px(S[3])};display:grid;place-items:center;
  width:${px(S[8] + S[1])};height:${px(S[8] + S[1])};padding:0;border:0;border-radius:${px(R.full)};
  background:${tint('surface-overlay', PLATE_PERCENT)};color:${v('text-primary')};cursor:pointer;
  -webkit-backdrop-filter:blur(${px(S[2])});backdrop-filter:blur(${px(S[2])})}
.reel-toggle svg{width:${px(S[4])};height:${px(S[4])};fill:currentColor;stroke:none}
`;
}

function momentCardsCss(): string {
  return `
.moments{${swipeRow(`minmax(${px(S[14] * 5)},82%)`)}}
.moment{scroll-snap-align:start;display:flex;flex-direction:column;min-width:0;background:${v('surface-overlay')};
  border:${hairline()};border-radius:${px(RD.photo)};overflow:hidden}
.moment-reel{aspect-ratio:4/5;border-radius:0}
.moment-body{display:flex;flex:1;flex-direction:column;align-items:flex-start;gap:${px(S[2])};padding:${px(S[5])}}
.moment-body h3,.moment-body p{margin:0}
.moment-body h3{${fluidType(webType.title)};font-weight:${T.h1.weight}}
.moment-tag{display:inline-flex;align-items:center;min-height:${px(S[6] + S[1])};padding:0 ${px(S[3])};
  border-radius:${px(R.full)};background:${v('accent-subtle')};${type(T.caption)};font-weight:${T.bodyStrong.weight};
  color:${v('text-primary')}}
.moment-meta{${type(T.caption)};color:${v('text-secondary')}}
.moment-price{${type(T.body)};color:${v('text-secondary')}}
.moment-price strong{color:${v('text-primary')};font-weight:${T.h1.weight}}
.moment-body .btn{margin-top:auto}
${mq(bp.sm)}{.moments{grid-auto-columns:minmax(0,46%)}}
${mq(bp.lg)}{
  .moments{grid-auto-flow:row;grid-template-columns:repeat(3,minmax(0,1fr));gap:${px(S[6])};overflow:visible;
    margin:0;padding:0}
  .moment-body{padding:${px(S[6])}}
}
`;
}

function reelWallCss(): string {
  return `
.reel-wall{${swipeRow('62%')}}
.reel-wall li{scroll-snap-align:start;min-width:0}
${mq(bp.sm)}{.reel-wall{grid-auto-columns:34%}}
${mq(bp.lg)}{.reel-wall{grid-auto-columns:minmax(0,1fr);gap:${px(S[4])}}}
`;
}

/** On the clay tint (people, the shoot): only primary, secondary or clay-deep text (DESIGN-DAYLIGHT). */
function creatorsCss(): string {
  return `
.creators{display:grid;gap:${px(S[6])};margin-top:${px(S[10])};padding:${px(S[6])};border-radius:${px(RD.photo)};
  background:${v('clay-default')};color:${v('text-primary')}}
.creators .eyebrow{color:${v('clay-deep')};margin-bottom:${px(S[3])}}
.creators h3{${fluidType(webType.figure)};margin:0 0 ${px(S[6])}}
.creators h3 em{font-style:normal;color:${v('clay-deep')}}
.creators .checklist{margin:0}
.creators .checklist li{color:${v('text-primary')}}
${mq(bp.lg)}{
  .creators{grid-template-columns:minmax(0,5fr) minmax(0,6fr);gap:${px(S[14])};padding:${px(S[14])};
    border-radius:${px(RD.panel)};box-shadow:${shadow('sm')};align-items:center}
}
`;
}
