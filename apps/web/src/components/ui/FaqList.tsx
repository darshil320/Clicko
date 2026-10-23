import type { Faq } from '../../content/types';

/** Native disclosure widgets: keyboard and screen-reader accessible with zero JavaScript. */
export function FaqList({ faqs }: { readonly faqs: readonly Faq[] }) {
  return (
    <div className="faq">
      {faqs.map((faq) => (
        <details key={faq.question}>
          <summary>{faq.question}</summary>
          <div className="answer">
            <p>{faq.answer}</p>
          </div>
        </details>
      ))}
    </div>
  );
}
