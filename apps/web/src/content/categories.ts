import type { BookableTier, CategoryCode } from './rate-card';
import type { Faq } from './types';

export interface Category {
  readonly slug: string;
  readonly code: CategoryCode;
  readonly label: string;
  /** "food photographer" — used in headings and titles. */
  readonly role: string;
  readonly summary: string;
  readonly bookedFor: readonly string[];
  /** Why the category uplift exists; null for baseline categories. */
  readonly upliftReason: string | null;
  readonly planning: readonly string[];
  readonly recommended: { readonly tier: BookableTier; readonly why: string };
  readonly faqs: readonly Faq[];
}

/** Launch categories in the seed's sort order. Uplifts live in rate-card.ts (doc 05 §5). */
export const CATEGORIES: readonly Category[] = [
  {
    slug: 'food',
    code: 'FOOD',
    label: 'Food',
    role: 'food photographer',
    summary: 'Menus, delivery-app listings and social posts that make people order.',
    bookedFor: [
      'Swiggy and Zomato listings',
      'Menu cards',
      'Instagram and reels stills',
      'Cloud-kitchen launches',
    ],
    upliftReason:
      'Food carries a 15% category uplift: every dish needs its own styling, light and often a reshoot while it is still fresh.',
    planning: [
      'Plate one dish at a time and keep the next one ready — the kitchen sets the pace, not the camera.',
      'Allow styling time per dish; a 2-hour shoot covers fewer dishes than most people expect.',
      'Send a shot list of dishes and angles at least 24 hours ahead so the photographer brings the right light.',
    ],
    recommended: {
      tier: 'PROFESSIONAL',
      why: 'Lighting is included and photographers are certified for food, which matters for colour and texture.',
    },
    faqs: [
      {
        question: 'Will the food photos be edited?',
        answer:
          'You receive every delivered frame as RAW plus an automatic full-resolution JPEG — no retouching. For finished, retouched menu images, add Clickco Edit after delivery.',
      },
      {
        question: 'Can I use the photos on Swiggy, Zomato and my menu?',
        answer:
          'Yes. Personal and commercial use are both included in the price, including delivery apps, print menus and ads. You cannot resell them as stock.',
      },
    ],
  },
  {
    slug: 'wedding',
    code: 'WEDDING',
    label: 'Wedding',
    role: 'wedding photographer',
    summary: 'Mehendi, haldi, pheras and the reception — moments that happen once.',
    bookedFor: [
      'Wedding ceremonies',
      'Mehendi and haldi',
      'Sangeet and receptions',
      'Engagements and roka',
    ],
    upliftReason:
      'Weddings carry a 25% category uplift: nothing can be reshot, days are long and physically demanding, and the stakes are high.',
    planning: [
      'Book each function as its own shoot so each one gets the hours it needs.',
      'Wedding season (1 Nov – 28 Feb) is Peak Season: festival pricing applies and cancellation terms are stricter — book early.',
      'Share the ritual timings and a family contact who can point out the people who matter.',
    ],
    recommended: {
      tier: 'PROFESSIONAL',
      why: 'Professional and Expert photographers record to two memory cards at once, so one failed card does not lose your pheras.',
    },
    faqs: [
      {
        question: 'Can I add a second photographer?',
        answer:
          'Yes. A second shooter is an add-on from the Semi-Pro tier upwards, charged per hour and shown in your quote before you pay.',
      },
      {
        question: 'What if the ceremony runs late?',
        answer:
          'The photographer can extend in one-hour blocks at your plan’s hourly rate, but only after you approve the extension in the app.',
      },
    ],
  },
  {
    slug: 'portrait',
    code: 'PORTRAIT',
    label: 'Portrait',
    role: 'portrait photographer',
    summary: 'Families, couples, maternity, kids and personal branding.',
    bookedFor: [
      'Family portraits',
      'Maternity and newborn',
      'Couple and pre-wedding shoots',
      'Personal branding',
    ],
    upliftReason: null,
    planning: [
      'The hour after sunrise and the hour before sunset give the softest outdoor light.',
      'Plan outfit changes in advance — each change takes time out of your booked hours.',
      'Some public spots need permission for professional gear; tell us the location when you book.',
    ],
    recommended: {
      tier: 'SEMI_PRO',
      why: 'A full-frame camera with two lenses gives flattering portraits and soft backgrounds without the cost of a lighting crew.',
    },
    faqs: [
      {
        question: 'Can we shoot at home?',
        answer:
          'Yes. Home shoots are common for families and newborns. Give the full address and pincode so the quote includes any travel charge.',
      },
      {
        question: 'How many photos will we get?',
        answer:
          'Each tier delivers a set number of frames per hour — from 40 on Basic to 75 on Expert — as RAW and full-resolution JPEG.',
      },
    ],
  },
  {
    slug: 'product',
    code: 'PRODUCT',
    label: 'Product',
    role: 'product photographer',
    summary: 'Catalogue and e-commerce photos with consistent light across every SKU.',
    bookedFor: [
      'Marketplace listings',
      'D2C websites',
      'Catalogues and lookbooks',
      'Packaging shots',
    ],
    upliftReason:
      'Product carries a 10% category uplift: the setup takes time, though it repeats quickly once lit.',
    planning: [
      'Group products by size and colour so the light only changes a few times.',
      'Tell us the marketplace specs (white background, aspect ratio) in your booking notes.',
      'Add the lighting kit if you are shooting reflective items like jewellery, steel or glass.',
    ],
    recommended: {
      tier: 'PROFESSIONAL',
      why: 'Consistent lighting across a large catalogue is what separates usable listings from reshoots.',
    },
    faqs: [
      {
        question: 'Can you shoot on a white background?',
        answer:
          'Yes — mention it when you book. Background removal and retouching are not part of RAW delivery; add Clickco Edit for finished, marketplace-ready files.',
      },
      {
        question: 'Do I get a GST invoice?',
        answer:
          'Yes. GST is itemised in every quote and you receive a tax invoice for every payment.',
      },
    ],
  },
  {
    slug: 'event',
    code: 'EVENT',
    label: 'Event',
    role: 'event photographer',
    summary: 'Birthdays, pujas, launches and gatherings — covered without fuss.',
    bookedFor: [
      'Birthdays and anniversaries',
      'Pujas and griha pravesh',
      'Store and product launches',
      'College and community events',
    ],
    upliftReason: null,
    planning: [
      'List the must-have moments — cake cutting, speeches, the family group photo — before the day.',
      'Parking and venue entry fees are chargeable and shown in your quote or invoice.',
      'Book a little longer than the programme; extensions need your in-app approval.',
    ],
    recommended: {
      tier: 'SEMI_PRO',
      why: 'Two lenses cover both the wide room and close candid moments at most indoor events.',
    },
    faqs: [
      {
        question: 'Can I book for later today?',
        answer:
          'Often, yes — but same-day bookings cost more and anything under 8 hours away is best effort. If no photographer accepts, you get a full refund automatically.',
      },
      {
        question: 'Do you shoot video?',
        answer: 'Not at launch. Clickco is photography only for now.',
      },
    ],
  },
  {
    slug: 'real-estate',
    code: 'REAL_ESTATE',
    label: 'Real Estate',
    role: 'real estate photographer',
    summary: 'Wide, bright interiors and exteriors for listings and brochures.',
    bookedFor: [
      'Rental and resale listings',
      'Builder brochures',
      'Show flats',
      'Hotels and homestays',
    ],
    upliftReason:
      'Real estate carries a 10% category uplift: wide lenses, bracketed exposures for bright windows and more frames per room.',
    planning: [
      'Shoot in daylight with every light switched on and curtains open.',
      'Declutter counters and remove personal items before the photographer arrives.',
      'Drone shots are an add-on from the Professional tier, subject to airspace clearance.',
    ],
    recommended: {
      tier: 'PROFESSIONAL',
      why: 'Lighting and a full-frame camera handle the gap between bright windows and darker rooms.',
    },
    faqs: [
      {
        question: 'Can you shoot an under-construction site?',
        answer:
          'Yes, where it is safe to enter. The photographer may stop a shoot if conditions become unsafe, so share site access and safety details in advance.',
      },
      {
        question: 'Is drone photography available?',
        answer:
          'Yes, as an add-on from the Professional tier. It needs a licensed drone operator and an airspace check for your location.',
      },
    ],
  },
  {
    slug: 'corporate',
    code: 'CORPORATE',
    label: 'Corporate',
    role: 'corporate photographer',
    summary: 'Headshots, offices and company events with a consistent look.',
    bookedFor: [
      'Team headshots',
      'Office and factory photos',
      'Conferences and offsites',
      'Leadership portraits',
    ],
    upliftReason:
      'Corporate carries a 20% category uplift: headshots must match across a whole team, on-site constraints are tight and expectations are high.',
    planning: [
      'Book a meeting room as a temporary studio so every headshot shares the same light and background.',
      'Send a schedule of people and time slots; allow around ten minutes per person.',
      'Tell us about security passes or gate entry so the photographer arrives on time.',
    ],
    recommended: {
      tier: 'PROFESSIONAL',
      why: 'Lighting is included, so headshots shot hours apart still match.',
    },
    faqs: [
      {
        question: 'Can we book regular shoots for the company?',
        answer:
          'Business accounts are set up manually for now. Book individual shoots in the app, or email us about repeat bookings.',
      },
      {
        question: 'Who owns the photos?',
        answer:
          'Clickco keeps the copyright and you get a perpetual licence for personal and commercial use — websites, ads, print and annual reports included.',
      },
    ],
  },
];

export function findCategory(slug: string): Category | undefined {
  return CATEGORIES.find((category) => category.slug === slug);
}
