import {
  ease,
  liftPx,
  motionMs,
  motionOk,
  ms,
  photoZoom,
  px,
  revealBlurPx,
  revealRange,
  staggerMs,
} from './tokens';

/** Lines of the 404 hero that enter in sequence: pill, headline, lead, actions, facts. */
const HERO_LINES = 5;

const heroStagger = (): string =>
  Array.from(
    { length: HERO_LINES },
    (_, i) => `.hero-copy>:nth-child(${i + 1}){animation-delay:${ms(i * staggerMs)}}`,
  ).join('');

/**
 * Every animation and transition on the site, behind one prefers-reduced-motion guard
 * (DESIGN-LIGHT §Motion: reduced motion gets no movement and instant state).
 * The blur-fade pattern from the Magic UI registry, rebuilt in token CSS.
 */
export function motionCss(): string {
  const quick = `${ms(motionMs.fastMs)} ${ease}`;
  return `${motionOk}{
@keyframes rise{from{opacity:0;translate:0 ${px(motionMs.revealRisePx)};filter:blur(${px(revealBlurPx)})}
  to{opacity:1;translate:none;filter:none}}
@keyframes fade-up{from{opacity:0;translate:0 ${px(motionMs.revealRisePx)}}to{opacity:1;translate:none}}
@keyframes photo-in{from{opacity:0;scale:${photoZoom}}to{opacity:1;scale:1}}
html{scroll-behavior:smooth}
.hero-copy>*,.hero-head>*,.picker,.hero-visual{animation:rise ${ms(motionMs.heroMs)} ${ease} both}
${heroStagger()}
.hero-head>:nth-child(2){animation-delay:${ms(staggerMs)}}
.picker{animation-delay:${ms(staggerMs * 2)}}
.hero-visual{animation-delay:${ms(staggerMs * 3)}}
.hero-photo img{animation:photo-in ${ms(motionMs.revealMs)} ${ease} both}
@supports (animation-timeline:view()){
  .reveal{animation:rise linear both;animation-timeline:view();
    animation-range:entry ${revealRange.from}% entry ${revealRange.to}%}
  .grid>li,.bento>li,.steps>li,.bands-list>li,.tiers>li,.faq>details{animation:fade-up linear both;
    animation-timeline:view();animation-range:entry ${revealRange.from}% entry ${revealRange.to}%}
}
.lift,.btn,.tab,.input,.nav-list a,.card-arrow,.cat-tile,.seg-opt>span,.stepper button{transition:transform ${quick},box-shadow ${quick},
  border-color ${quick},background-color ${quick},color ${quick}}
.lift:hover{transform:translateY(${px(-liftPx)})}
.btn-primary:hover,.btn-dark:hover{transform:translateY(${px(-liftPx / 2)})}
.lift:hover .card-arrow{transform:translateX(${px(liftPx)})}
.photo::before{transition:scale ${ms(motionMs.heroMs)} ${ease}}
.lift:hover>.photo::before{scale:${photoZoom}}
.faq summary::after{transition:transform ${ms(motionMs.revealMs)} ${ease}}
}`;
}
