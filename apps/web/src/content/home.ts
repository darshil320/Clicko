import type { Faq } from './types';

export interface Step {
  readonly title: string;
  readonly body: string;
}

/** Book → photographer assigned → shoot → photos in 48 h (v0.2 §6, T&C §2, §5). */
export const HOW_IT_WORKS: readonly Step[] = [
  {
    title: 'Book in the app',
    body:
      'Pick a tier, a category, the date and the venue. You see the full price with GST before ' +
      'you pay — 50% to book, or 100% when the shoot is within 24 hours.',
  },
  {
    title: 'A photographer is assigned',
    body:
      'A verified photographer of your tier and category accepts the job. You see who is coming, ' +
      'and the app tells you when they are on the way.',
  },
  {
    title: 'The shoot',
    body:
      'Your photographer checks in on arrival and shoots for the hours you booked. Running over? ' +
      'Extensions happen only after you approve them in the app.',
  },
  {
    title: 'Photos in 48 hours',
    body:
      'Every delivered frame as camera RAW plus a full-resolution JPEG, by secure link, within ' +
      '48 hours of the shoot ending and the balance being paid.',
  },
];

export interface TrustPoint {
  readonly title: string;
  readonly body: string;
  readonly link?: { readonly label: string; readonly href: string };
}

export const TRUST_POINTS: readonly TrustPoint[] = [
  {
    title: 'Verified photographers',
    body:
      'Every photographer passes KYC, police verification and a portfolio review by our team ' +
      'before their first booking. We never store Aadhaar numbers.',
  },
  {
    title: 'Dual-card backup',
    body:
      'On Professional and Expert, cameras record to two memory cards at once, so a single card ' +
      'failure does not lose your shoot. Signature adds on-site backup.',
  },
  {
    title: 'GST invoices, no surprises',
    body:
      'Prices are shown with GST in the same place, never revealed at checkout. You get a tax ' +
      'invoice for every payment.',
  },
  {
    title: 'A named Grievance Officer',
    body:
      'Complaints are acknowledged within 48 hours and resolved within 30 days, as the Consumer ' +
      'Protection (E-Commerce) Rules require.',
    link: { label: 'Grievance redressal', href: '/grievance/' },
  },
];

export const HOME_FAQS: readonly Faq[] = [
  {
    question: 'Are prices inclusive of GST?',
    answer:
      'No. Prices are shown exclusive of 18% GST, with the GST-inclusive total right next to them. ' +
      'A 2-hour Professional shoot in Surat is ₹8,500 + ₹1,530 GST = ₹10,030.',
  },
  {
    question: 'Do you edit the photos?',
    answer:
      'Standard plans deliver every frame unedited: camera RAW plus an automatic full-resolution ' +
      'JPEG conversion, with no colour correction or retouching. Clickco Edit is a separate paid ' +
      'service with its own 5–7 day turnaround, which you can add after delivery.',
  },
  {
    question: 'How long can I download my photos?',
    answer:
      'RAW files are available for 7 days from delivery and JPEGs for 30 days. After that they ' +
      'are permanently deleted, so download them as soon as they arrive.',
  },
  {
    question: 'Can I use the photos for my business?',
    answer:
      'Yes. Personal and commercial use are both included at the same price — social media, ' +
      'ads, packaging, print and websites. Clickco keeps the copyright, and the photos cannot be ' +
      'resold as stock.',
  },
  {
    question: 'Can I choose my photographer?',
    answer:
      'We assign a verified photographer who matches your tier and category. Only Signature ' +
      'bookings let you see and approve a named photographer’s portfolio first.',
  },
  {
    question: 'What if I need to cancel?',
    answer:
      'How much of your advance comes back depends on how much notice you give and whether your ' +
      'date falls in Peak Season. Emergency bookings can be cancelled free until a photographer ' +
      'accepts. The full rules are in our Refund & Cancellation Policy.',
  },
  {
    question: 'Do you shoot video?',
    answer: 'Not at launch — Clickco is photography only for now.',
  },
  {
    question: 'My city is not listed. Can I still book?',
    answer:
      'Not yet. Join the waitlist with your pincode: waitlist demand decides which city we open ' +
      'next, and we will tell you when we reach you.',
  },
];
