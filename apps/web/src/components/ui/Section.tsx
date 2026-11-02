import type { ReactNode } from 'react';

export interface SectionProps {
  readonly id: string;
  /** Plain text: one weight, one colour, no eyebrow above it (ADR-0028). */
  readonly title: string;
  readonly lead?: ReactNode;
  /** Linen band (surface/raised): one per page (DESIGN-DAYLIGHT §Rules). */
  readonly raised?: boolean;
  /** The darkroom panel: one per page, for the Emergency explainer (ADR-0018). */
  readonly dark?: boolean;
  /** Centre the heading block over the content. */
  readonly centered?: boolean;
  /** Heading on the left, content on the right (desktop); stacked on small screens. */
  readonly split?: boolean;
  readonly children: ReactNode;
}

/** A labelled page section with the standard heading block and token section rhythm. */
export function Section({
  id,
  title,
  lead,
  raised = false,
  dark = false,
  centered = false,
  split = false,
  children,
}: SectionProps) {
  const headingId = `${id}-title`;
  const head = (
    <div className={centered ? 'section-head section-head-center reveal' : 'section-head reveal'}>
      <h2 id={headingId}>{title}</h2>
      {lead ? <p className="lead">{lead}</p> : null}
    </div>
  );
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      className={['section', raised && 'section-raised', dark && 'section-dark']
        .filter(Boolean)
        .join(' ')}
    >
      {split ? (
        <div className="wrap section-split">
          {head}
          <div>{children}</div>
        </div>
      ) : (
        <div className="wrap">
          {head}
          {children}
        </div>
      )}
    </section>
  );
}
