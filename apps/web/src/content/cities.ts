import type { LaunchCityTier } from './rate-card';
import type { Faq } from './types';

/** Launch config, v0.2 §7: Surat LIVE · Mumbai LIVE · Vadodara PILOT · everything else WAITLIST. */
export type LaunchStatus = 'LIVE' | 'PILOT';

export interface LaunchCity {
  readonly slug: string;
  readonly name: string;
  readonly state: string;
  readonly status: LaunchStatus;
  readonly tier: LaunchCityTier;
  /** One-line positioning used in cards and meta descriptions. */
  readonly summary: string;
  readonly intro: string;
  /** Example neighbourhoods. Coverage is decided per pincode, which the app checks first. */
  readonly areas: readonly string[];
  /** Festival pricing that applies in this city (doc 05 §5 festival_calendar). */
  readonly festivals: string;
  readonly faqs: readonly Faq[];
}

const COVERAGE_FAQ = (city: string): Faq => ({
  question: `Do you cover all of ${city}?`,
  answer:
    `We serve pincodes across ${city}. The app checks your venue's pincode before you book — ` +
    'most carry no travel charge, and outer areas show any travel charge in your quote before you pay.',
});

export const LAUNCH_CITIES: readonly LaunchCity[] = [
  {
    slug: 'surat',
    name: 'Surat',
    state: 'Gujarat',
    status: 'LIVE',
    tier: 'TIER_1',
    summary: 'Live across the city — from Adajan and Vesu to Varachha and Katargam.',
    intro:
      'Surat is where Clickco started. Textile houses on Ring Road, diamond firms, new cafés along ' +
      'VIP Road and family functions every weekend — our photographers shoot all of it, booked ' +
      'from your phone with the full price shown before you pay.',
    areas: ['Adajan', 'Vesu', 'Piplod', 'Athwa', 'Pal', 'City Light', 'Varachha', 'Katargam'],
    festivals:
      'Navratri, Diwali week, Christmas–New Year and wedding season (1 Nov – 28 Feb) carry ' +
      'festival pricing in Surat.',
    faqs: [
      COVERAGE_FAQ('Surat'),
      {
        question: 'Is Navratri more expensive to book in Surat?',
        answer:
          'Yes. Navratri is Peak Season in Surat and Vadodara, so festival pricing applies and ' +
          'the Peak Season cancellation terms cover those dates. The app shows the exact dates and ' +
          'the full price before you pay.',
      },
    ],
  },
  {
    slug: 'mumbai',
    name: 'Mumbai',
    state: 'Maharashtra',
    status: 'LIVE',
    tier: 'METRO',
    summary: 'Live in Mumbai — restaurants, homes, offices and venues across the city.',
    intro:
      'Mumbai moves fast and so do bookings here: a restaurant reshoot in Bandra, headshots for a ' +
      'team in Lower Parel, a family portrait in Powai. Mumbai is priced at our metro rate, and ' +
      'every quote shows GST in the same place as the price.',
    areas: ['Bandra', 'Andheri', 'Powai', 'Lower Parel', 'Juhu', 'Colaba', 'Malad', 'Chembur'],
    festivals:
      'Ganesh Chaturthi, Diwali week, Christmas–New Year and wedding season (1 Nov – 28 Feb) ' +
      'carry festival pricing in Mumbai.',
    faqs: [
      COVERAGE_FAQ('Mumbai'),
      {
        question: 'Why does Mumbai cost more than Surat?',
        answer:
          'Mumbai is on our metro rate card, which reflects higher costs for photographers in ' +
          'the city. A 2-hour Basic shoot starts at ₹4,000 + GST in Mumbai against ₹3,500 + GST ' +
          'in Surat.',
      },
    ],
  },
  {
    slug: 'vadodara',
    name: 'Vadodara',
    state: 'Gujarat',
    status: 'PILOT',
    tier: 'TIER_1',
    summary: 'Pilot in Vadodara — bookable now, with limited photographer availability.',
    intro:
      'Vadodara is in pilot. You can book today at the same prices as Surat, but we have fewer ' +
      'photographers here for now, so we take a little longer to confirm a match. Booking a few ' +
      'days ahead gives you the best chance.',
    areas: ['Alkapuri', 'Akota', 'Fatehgunj', 'Gotri', 'Manjalpur', 'Sayajigunj', 'Karelibaug'],
    festivals:
      'Navratri, Diwali week, Christmas–New Year and wedding season (1 Nov – 28 Feb) carry ' +
      'festival pricing in Vadodara.',
    faqs: [
      COVERAGE_FAQ('Vadodara'),
      {
        question: 'What does "pilot" mean for my booking?',
        answer:
          'Your booking works exactly as in Surat and Mumbai — same prices, same 48-hour ' +
          'delivery. The difference is supply: with fewer photographers, it can take longer to ' +
          'confirm one, so the app shows a limited-availability notice and we suggest booking ' +
          'a few days ahead.',
      },
    ],
  },
];

/** Shown on /cities as examples of waitlist cities; every other Indian pincode qualifies too. */
export const WAITLIST_EXAMPLES: readonly string[] = [
  'Ahmedabad',
  'Pune',
  'Bengaluru',
  'Delhi NCR',
  'Hyderabad',
  'Chennai',
  'Jaipur',
  'Kolkata',
];

export function findCity(slug: string): LaunchCity | undefined {
  return LAUNCH_CITIES.find((city) => city.slug === slug);
}

export function statusLabel(status: LaunchStatus): string {
  return status === 'LIVE' ? 'Live' : 'Pilot — limited availability';
}
