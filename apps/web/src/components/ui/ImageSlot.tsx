import type { ReactNode } from 'react';

export interface ImageSlotProps {
  /** Optional photograph. Without one, the slot renders a token-surface viewfinder frame. */
  readonly src?: string;
  readonly alt?: string;
  readonly width?: number;
  readonly height?: number;
  /** Small caption shown at the top of the frame, e.g. "Surat · Professional". */
  readonly label?: ReactNode;
  readonly children?: ReactNode;
}

/**
 * A place for photography that does not depend on stock images. Real photos can drop in later
 * via `src` (full-bleed, no rounded corners — DESIGN.md §Layout rules).
 */
export function ImageSlot({ src, alt = '', width, height, label, children }: ImageSlotProps) {
  return (
    <figure className="viewfinder">
      {label ? (
        <figcaption className="viewfinder-label">
          <span>{label}</span>
          <span aria-hidden="true">REC ●</span>
        </figcaption>
      ) : null}
      {src ? (
        // biome-ignore lint/performance/noImgElement: static export has no image optimiser (next.config output: 'export')
        <img src={src} alt={alt} width={width} height={height} loading="lazy" />
      ) : null}
      {children}
    </figure>
  );
}
