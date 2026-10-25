import type { CategoryCode } from '../../content/rate-card';

/** Placeholder light for a frame without a photograph (styles/photo.ts MOODS). */
export type PhotoMood = 'golden' | 'plate' | 'garden' | 'studio' | 'night' | 'coast' | 'office';

/** One mood per launch category. Typed on CategoryCode, so a new category fails to compile. */
export const CATEGORY_MOOD: Readonly<Record<CategoryCode, PhotoMood>> = {
  FOOD: 'plate',
  WEDDING: 'golden',
  PORTRAIT: 'garden',
  PRODUCT: 'studio',
  EVENT: 'night',
  REAL_ESTATE: 'coast',
  CORPORATE: 'office',
};

/** Placeholder light per launch city (by slug) until real city photographs exist. */
export const CITY_MOOD: Readonly<Record<string, PhotoMood>> = {
  surat: 'golden',
  mumbai: 'coast',
  vadodara: 'garden',
};

export interface PhotoFrameProps {
  readonly mood: PhotoMood;
  /** A real photograph. Without one the frame paints its mood and is hidden from assistive tech. */
  readonly src?: string;
  readonly alt?: string;
  /** What belongs in the frame, e.g. "Wedding · Surat". */
  readonly caption?: string;
  readonly shape?: 'portrait' | 'wide' | 'square' | 'fill';
  readonly className?: string;
  /** Above-the-fold photos load at once and first; everything else waits until it is near. */
  readonly priority?: boolean;
}

const SHAPE_CLASS = {
  portrait: '',
  wide: 'photo-wide',
  square: 'photo-square',
  fill: 'photo-fill',
} as const;

/**
 * The image container of the site (DESIGN-DAYLIGHT §Imagery). Real photos drop in through `src`;
 * until then each frame shows a placeholder mood and a caption naming what goes there.
 */
export function PhotoFrame({
  mood,
  src,
  alt = '',
  caption,
  shape = 'portrait',
  className,
  priority = false,
}: PhotoFrameProps) {
  const classes = ['photo', `mood-${mood}`, SHAPE_CLASS[shape], src ? 'photo-real' : '', className]
    .filter(Boolean)
    .join(' ');
  return (
    <figure className={classes} aria-hidden={src ? undefined : true}>
      {src ? (
        // biome-ignore lint/performance/noImgElement: static export has no image optimiser (next.config output: 'export')
        <img
          src={src}
          alt={alt}
          loading={priority ? 'eager' : 'lazy'}
          fetchPriority={priority ? 'high' : 'auto'}
          decoding="async"
        />
      ) : null}
      {caption ? <span className="photo-cap">{caption}</span> : null}
    </figure>
  );
}
