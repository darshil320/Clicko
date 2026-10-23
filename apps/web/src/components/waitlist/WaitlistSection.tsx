import { productionApiProblem } from '../../lib/waitlist';
import { Section } from '../ui/Section';
import { WaitlistForm } from './WaitlistForm';

export function WaitlistSection() {
  // Runs at export time: a production build must never ship a form that posts to localhost.
  const problem = productionApiProblem(process.env);
  if (problem) throw new Error(problem);
  return (
    <Section
      id="waitlist"
      eyebrow="Waitlist"
      title="Want Clickco in your city?"
      lead="Tell us where you need a photographer. We open new cities in order of waitlist demand, and we will message you when booking opens near you."
    >
      <div className="split">
        <WaitlistForm />
        <div>
          <h3>How the waitlist works</h3>
          <ul className="checklist">
            <li>One entry per pincode is all it takes — no account, no payment.</li>
            <li>Waitlist numbers decide which city we launch next.</li>
            <li>We message you once booking opens near you, and not for anything else.</li>
            <li>
              Already in Surat, Mumbai or Vadodara? You can book there as soon as the app launches.
            </li>
          </ul>
        </div>
      </div>
    </Section>
  );
}
