import { HOW_IT_WORKS } from '../../content/home';
import { Section } from '../ui/Section';

export function HowItWorks() {
  return (
    <Section
      id="how-it-works"
      eyebrow="How it works"
      title="From booking to photos in four steps"
      lead="No calls, no negotiating, no chasing a photographer for files."
    >
      <ol className="grid grid-4 steps">
        {HOW_IT_WORKS.map((step, index) => (
          <li key={step.title} className="card">
            <span className="step-num" aria-hidden="true">
              {index + 1}
            </span>
            <h3>
              <span className="sr-only">Step {index + 1}: </span>
              {step.title}
            </h3>
            <p className="muted">{step.body}</p>
          </li>
        ))}
      </ol>
    </Section>
  );
}
