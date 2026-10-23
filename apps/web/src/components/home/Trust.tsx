import { TRUST_POINTS } from '../../content/home';
import { Section } from '../ui/Section';

export function Trust() {
  return (
    <Section
      id="trust"
      raised
      eyebrow="Why Clickco"
      title="Built so you never have to chase anyone"
      lead="Clickco sells the shoot and stands behind it: one company responsible for the photographer, the price and the delivery."
    >
      <ul className="grid grid-4">
        {TRUST_POINTS.map((point) => (
          <li key={point.title} className="card">
            <h3>{point.title}</h3>
            <p className="muted">{point.body}</p>
            {point.link ? (
              <p className="push">
                <a href={point.link.href}>{point.link.label}</a>
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </Section>
  );
}
