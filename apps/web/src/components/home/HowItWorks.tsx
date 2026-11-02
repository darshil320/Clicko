import { HOW_IT_WORKS } from '../../content/home';
import { STEP_PHOTOS } from '../../content/photos';
import { PhotoFrame, type PhotoMood } from '../ui/PhotoFrame';
import { Section } from '../ui/Section';

/** Each step's light while its photo loads, in HOW_IT_WORKS order. */
const MOODS: readonly PhotoMood[] = ['golden', 'garden', 'night', 'coast'];

export function HowItWorks() {
  return (
    <Section
      id="how-it-works"
      title={['Booked like a ride.', 'Delivered like a studio.']}
      lead="From booking to photos in four steps. No calls, no negotiating, no chasing a photographer for files."
    >
      <ol className="steps">
        {HOW_IT_WORKS.map((step, index) => (
          <li key={step.title} className="card card-photo step">
            <span className="step-num" aria-hidden="true">
              {index + 1}
            </span>
            <PhotoFrame
              mood={MOODS[index % MOODS.length] ?? 'golden'}
              src={STEP_PHOTOS[index]?.src}
            />
            <div className="card-body">
              <h3>
                <span className="sr-only">Step {index + 1}: </span>
                {step.title}
              </h3>
              <p className="muted">{step.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </Section>
  );
}
