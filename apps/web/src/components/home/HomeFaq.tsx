import { HOME_FAQS } from '../../content/home';
import { FaqList } from '../ui/FaqList';
import { Section } from '../ui/Section';

export function HomeFaq() {
  return (
    <Section
      id="faq"
      split
      eyebrow="Help"
      title={
        <>
          Questions, <em>answered.</em>
        </>
      }
      lead={
        <>
          Still stuck? Read the <a href="/terms/">Terms &amp; Conditions</a> and the{' '}
          <a href="/refund-policy/">Refund &amp; Cancellation Policy</a>, or contact our{' '}
          <a href="/grievance/">Grievance Officer</a>.
        </>
      }
    >
      <FaqList faqs={HOME_FAQS} />
    </Section>
  );
}
