'use client';

import { useEffect, useRef, useState } from 'react';
import type { SiteReel } from '../../content/reels';
import { Icon } from './Icon';

/**
 * A muted, looping 9:16 reel (ADR-0023). It plays only while on screen and never under
 * prefers-reduced-motion (checked live), where the poster stays. Every reel has a pause button
 * (WCAG 2.2.2: the loops run longer than five seconds). Off-screen reels download nothing.
 * The video itself is decorative: the caption and surrounding copy carry the meaning.
 */
export function ReelVideo({
  reel,
  caption,
  className,
  priority = false,
}: {
  readonly reel: SiteReel;
  readonly caption?: string;
  readonly className?: string;
  /**
   * Above the fold: fetch the metadata (duration, first frame) at once rather than on first
   * play; the bytes stream when it starts playing, so the poster wins the LCP race.
   */
  readonly priority?: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [stopped, setStopped] = useState(false);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)');
    let onScreen = false;
    const sync = () => {
      if (onScreen && !still.matches && !stopped) {
        video.play().catch(() => undefined);
      } else {
        video.pause();
      }
    };
    const watch = new IntersectionObserver(
      ([entry]) => {
        onScreen = entry?.isIntersecting ?? false;
        sync();
      },
      { threshold: 0.25 },
    );
    watch.observe(video);
    still.addEventListener('change', sync);
    return () => {
      watch.disconnect();
      still.removeEventListener('change', sync);
    };
  }, [stopped]);

  const name = caption ?? 'reel';
  return (
    <figure className={['reel', className].filter(Boolean).join(' ')}>
      <video
        ref={ref}
        src={reel.src}
        poster={reel.poster}
        muted
        loop
        playsInline
        preload={priority ? 'metadata' : 'none'}
        aria-hidden="true"
        tabIndex={-1}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
      />
      <button
        type="button"
        className="reel-toggle"
        aria-label={playing ? `Pause ${name}` : `Play ${name}`}
        onClick={() => {
          setStopped(playing);
          // A tap is the visitor's own choice, so it plays even where autoplay holds back.
          if (!playing) ref.current?.play().catch(() => undefined);
        }}
      >
        <Icon name={playing ? 'pause' : 'play'} />
      </button>
      {caption ? <figcaption className="photo-cap">{caption}</figcaption> : null}
    </figure>
  );
}
