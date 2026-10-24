import type { ReactNode } from 'react';

export interface SectionProps {
  readonly id: string;
  readonly title: string;
  readonly eyebrow?: string;
  readonly lead?: ReactNode;
  /** Warm off-white band (surface/raised) to separate it from its neighbours. */
  readonly raised?: boolean;
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
  eyebrow,
  lead,
  raised = false,
  centered = false,
  split = false,
  children,
}: SectionProps) {
  const headingId = `${id}-title`;
  const head = (
    <div className={centered ? 'section-head section-head-center reveal' : 'section-head reveal'}>
      {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
      <h2 id={headingId}>{title}</h2>
      {lead ? <p className="lead">{lead}</p> : null}
    </div>
  );
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      className={raised ? 'section section-raised' : 'section'}
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
