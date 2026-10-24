import {
  ambient,
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

/** Hero lines that enter in sequence: pill, headline, lead, actions, facts, stage. */
const HERO_LINES = 6;

const heroStagger = (): string =>
  Array.from(
    { length: HERO_LINES },
    (_, i) => `.hero-copy>:nth-child(${i + 1}){animation-delay:${ms(i * staggerMs)}}`,
  ).join('');

/**
 * Every animation and transition on the site, behind one prefers-reduced-motion guard
 * (DESIGN-LIGHT §Motion: reduced motion gets no movement and instant state).
 * Patterns from the Magic UI registry (blur-fade, marquee), rebuilt in token CSS.
 */
export function motionCss(): string {
  const quick = `${ms(motionMs.fastMs)} ${ease}`;
  return `${motionOk}{
@keyframes rise{from{opacity:0;translate:0 ${px(motionMs.revealRisePx)};filter:blur(${px(revealBlurPx)})}
  to{opacity:1;translate:none;filter:none}}
@keyframes fade-up{from{opacity:0;translate:0 ${px(motionMs.revealRisePx)}}to{opacity:1;translate:none}}
@keyframes marquee{to{transform:translateX(-50%)}}
@keyframes ping{from{transform:scale(1);opacity:${ambient.pulseOpacity}}to{transform:scale(${ambient.pulseScale});opacity:0}}
@keyframes bob{50%{translate:0 ${px(-ambient.floatPx)}}}
html{scroll-behavior:smooth}
.hero-copy>*,.hero-stage{animation:rise ${ms(motionMs.heroMs)} ${ease} both}
${heroStagger()}
.hero-stage{animation-delay:${ms(HERO_LINES * staggerMs)}}
.live-dot::after{animation:ping ${ambient.pulseS}s ${ease} infinite}
.float{animation:bob ${ambient.floatS}s ease-in-out infinite}
.float-end{animation-delay:${-ambient.floatS / 2}s}
.marquee-track{animation:marquee ${ambient.marqueeS}s linear infinite}
.marquee:hover .marquee-track,.marquee:focus-within .marquee-track{animation-play-state:paused}
@supports (animation-timeline:view()){
  .reveal{animation:rise linear both;animation-timeline:view();
    animation-range:entry ${revealRange.from}% entry ${revealRange.to}%}
  .grid>li,.bento>li,.steps>li,.marquee-band,.bands-list>li,.tiers>li,.faq>details{animation:fade-up linear both;
    animation-timeline:view();animation-range:entry ${revealRange.from}% entry ${revealRange.to}%}
}
.lift,.btn,.tab,.input,.nav-list a,.card-arrow{transition:transform ${quick},box-shadow ${quick},
  border-color ${quick},background-color ${quick},color ${quick}}
.lift:hover{transform:translateY(${px(-liftPx)})}
.btn-primary:hover,.btn-dark:hover{transform:translateY(${px(-liftPx / 2)})}
.lift:hover .card-arrow{transform:translateX(${px(liftPx)})}
.photo::before{transition:scale ${ms(motionMs.heroMs)} ${ease}}
.lift:hover>.photo::before{scale:${photoZoom}}
.hero-stage .photo{animation:rise ${ms(motionMs.heroMs)} ${ease} both}
.hero-stage .collage-top{animation-delay:${ms(staggerMs * 2)}}
.hero-stage .collage-bottom{animation-delay:${ms(staggerMs * 4)}}
.faq summary::after{transition:transform ${ms(motionMs.revealMs)} ${ease}}
}`;
}
