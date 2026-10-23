import type { ReactNode } from 'react';

export interface SectionProps {
  readonly id: string;
  readonly title: string;
  readonly eyebrow?: string;
  readonly lead?: ReactNode;
  readonly raised?: boolean;
  readonly children: ReactNode;
}

/** A labelled page section with the standard heading block. */
export function Section({ id, title, eyebrow, lead, raised = false, children }: SectionProps) {
  const headingId = `${id}-title`;
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      className={raised ? 'section section-raised' : 'section'}
    >
      <div className="wrap">
        <div className="section-head">
          {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
          <h2 id={headingId}>{title}</h2>
          {lead ? <p className="lead">{lead}</p> : null}
        </div>
        {children}
      </div>
    </section>
  );
}
