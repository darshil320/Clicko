import { TRUST_POINTS } from '../../content/home';
import { Section } from '../ui/Section';

/** Daylight tints by meaning: trust, the shoot itself, money and files; the last stays white. */
const TONES = ['tone-sage', 'tone-clay', 'tone-haze', ''] as const;

/** Tinted bento (Magic UI bento-grid in token CSS): the first and last tiles run wide. No icon
 * tiles above the headings (ADR-0028 D7): the tint carries the grouping. */
export function Trust() {
  const last = TRUST_POINTS.length - 1;
  return (
    <Section
      id="trust"
      title="Built so you never chase anyone."
      lead="Clickco sells the shoot and stands behind it: one company responsible for the photographer, the price and the delivery."
    >
      <ul className="bento">
        {TRUST_POINTS.map((point, index) => {
          const wide = index === 0 || index === last;
          return (
            <li
              key={point.title}
              className={['card tile', wide && 'tile-wide', TONES[index % TONES.length]]
                .filter(Boolean)
                .join(' ')}
            >
              <h3>{point.title}</h3>
              <p className="muted">{point.body}</p>
              {point.link ? (
                <p className="push">
                  <a className="text-link" href={point.link.href}>
                    {point.link.label}
                  </a>
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
