import { HOW_IT_WORKS } from '../../content/home';
import { PhotoFrame, type PhotoMood } from '../ui/PhotoFrame';
import { Section } from '../ui/Section';

/** One placeholder mood per step, in HOW_IT_WORKS order: booking, the match, the shoot, delivery. */
const MOODS: readonly PhotoMood[] = ['golden', 'garden', 'night', 'coast'];
/** Fact chip tones by meaning: payment, verification, people, files (DESIGN-DAYLIGHT §Colour). */
const TONES = ['badge-accent', 'badge-sage', 'badge-clay', 'badge-haze'] as const;

export function HowItWorks() {
  return (
    <Section
      id="how-it-works"
      eyebrow="How it works"
      title={
        <>
          Booked like a ride. <em>Delivered like a studio.</em>
        </>
      }
      lead="From booking to photos in four steps. No calls, no negotiating, no chasing a photographer for files."
    >
      <ol className="steps">
        {HOW_IT_WORKS.map((step, index) => (
          <li key={step.title} className="card card-photo step">
            <span className="step-num" aria-hidden="true">
              {index + 1}
            </span>
            <PhotoFrame mood={MOODS[index % MOODS.length] ?? 'golden'} />
            <div className="card-body">
              <h3>
                <span className="sr-only">Step {index + 1}: </span>
                {step.title}
              </h3>
              <p className="muted">{step.body}</p>
              <span className={`badge ${TONES[index % TONES.length]}`}>{step.fact}</span>
            </div>
          </li>
        ))}
      </ol>
    </Section>
  );
}
