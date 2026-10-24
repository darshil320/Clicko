import { TRUST_POINTS } from '../../content/home';
import { Icon, IconChip, type IconName } from '../ui/Icon';
import { Section } from '../ui/Section';

/** Glyphs in TRUST_POINTS order: verification, dual-card backup, GST invoices, grievance. */
const GLYPHS: readonly IconName[] = ['shield', 'layers', 'receipt', 'message'];
/** Daylight tints by meaning: trust, the shoot itself, money and files; the last stays white. */
const TONES = ['tone-sage', 'tone-clay', 'tone-haze', ''] as const;

/** Tinted bento (Magic UI bento-grid in token CSS): the first and last tiles run wide. */
export function Trust() {
  const last = TRUST_POINTS.length - 1;
  return (
    <Section
      id="trust"
      eyebrow="Why Clickco"
      title={
        <>
          Built so you never <em>chase anyone.</em>
        </>
      }
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
              <IconChip name={GLYPHS[index % GLYPHS.length] ?? 'check'} />
              <h3>{point.title}</h3>
              <p className="muted">{point.body}</p>
              {wide && point.facts ? (
                <ul className="chips push" aria-label={`${point.title}: key facts`}>
                  {point.facts.map((fact) => (
                    <li key={fact} className="chip">
                      <Icon name="check" />
                      {fact}
                    </li>
                  ))}
                </ul>
              ) : null}
              {point.link ? (
                <p className={wide && point.facts ? undefined : 'push'}>
                  <a className="text-link" href={point.link.href}>
                    {point.link.label}
                    <Icon name="arrowRight" />
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
