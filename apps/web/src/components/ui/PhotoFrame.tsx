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

export interface PhotoFrameProps {
  readonly mood: PhotoMood;
  /** A real photograph. Without one the frame paints its mood and is hidden from assistive tech. */
  readonly src?: string;
  readonly alt?: string;
  /** What belongs in the frame, e.g. "Wedding · Surat". */
  readonly caption?: string;
  /** Camera line, e.g. "85mm · f/1.8". */
  readonly meta?: string;
  readonly corners?: boolean;
  readonly shape?: 'portrait' | 'wide' | 'square' | 'fill' | 'pill';
  readonly className?: string;
}

const SHAPE_CLASS = {
  portrait: '',
  wide: 'photo-wide',
  square: 'photo-square',
  fill: 'photo-fill',
  pill: 'photo-pill',
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
  meta,
  corners = false,
  shape = 'portrait',
  className,
}: PhotoFrameProps) {
  const classes = ['photo', `mood-${mood}`, SHAPE_CLASS[shape], className].filter(Boolean).join(' ');
  const Tag = shape === 'pill' ? 'span' : 'figure';
  return (
    <Tag className={classes} aria-hidden={src ? undefined : true}>
      {src ? (
        // biome-ignore lint/performance/noImgElement: static export has no image optimiser (next.config output: 'export')
        <img src={src} alt={alt} loading="lazy" />
      ) : null}
      {corners ? <span className="photo-corners" /> : null}
      {meta ? <span className="photo-meta">{meta}</span> : null}
      {caption ? <span className="photo-cap">{caption}</span> : null}
    </Tag>
  );
}
