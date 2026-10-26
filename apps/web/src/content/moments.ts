import type { BookableTier, CategoryCode } from './rate-card';

/**
 * What a booking captures (ADR-0023). A marketing-page choice only: the booking API's media model
 * belongs in packages/contracts when video ships. Video is priced in the app until then.
 */
export type ShootMedia = 'PHOTO' | 'VIDEO' | 'BOTH';

export const MEDIA_OPTIONS: readonly { readonly value: ShootMedia; readonly label: string }[] = [
  { value: 'PHOTO', label: 'Photos' },
  { value: 'VIDEO', label: 'Video' },
  { value: 'BOTH', label: 'Photos + video' },
];

/** Terms §4.3: video is delivered unedited and camera-original; edits are a separate paid service. */
export const VIDEO_DELIVERY = 'Unedited camera-original clips · reel edits are a paid add-on';
export const VIDEO_PRICE_NOTE = 'priced in the app at launch';

/** A real reason people book, mapped onto a bookable rate-card shoot so its price is exact. */
export interface Moment {
  readonly id: string;
  readonly tag: string;
  readonly title: string;
  readonly body: string;
  /** The shoot "Book this" puts in the hero picker. */
  readonly preset: {
    readonly category: CategoryCode;
    readonly tier: BookableTier;
    readonly hours: number;
    readonly media: ShootMedia;
  };
  /** A sample reel in public/reels (content/reels.ts). */
  readonly reel: string;
}

export const MOMENTS: readonly Moment[] = [
  {
    id: 'new-city',
    tag: 'Travel',
    title: 'In a new city for the weekend?',
    body:
      'Meet a local photographer at the spots worth the trip. Two hours, no selfie arm, and a ' +
      'camera roll you will actually post.',
    preset: { category: 'PORTRAIT', tier: 'SEMI_PRO', hours: 2, media: 'BOTH' },
    reel: 'new-city',
  },
  {
    id: 'proposal',
    tag: 'Proposal',
    title: 'Planning the big question?',
    body:
      'Tell us the spot and the signal. Your photographer blends into the crowd and catches the ' +
      'knee, the ring and the yes, in photos and video.',
    preset: { category: 'PORTRAIT', tier: 'PROFESSIONAL', hours: 2, media: 'BOTH' },
    reel: 'proposal',
  },
  {
    id: 'creator',
    tag: 'Creators',
    title: 'A content day for your feed',
    body:
      'A few outfits, a few locations, one booking. Stills for the grid and camera-original clips ' +
      'for your reels, usable in brand deals.',
    preset: { category: 'PORTRAIT', tier: 'PROFESSIONAL', hours: 3, media: 'BOTH' },
    reel: 'creator',
  },
  {
    id: 'birthday',
    tag: 'Party',
    title: 'The birthday dump, done right',
    body:
      'Someone always ends up behind the phone. Book a pro so everyone is actually in the photos, ' +
      'cake moment included.',
    preset: { category: 'EVENT', tier: 'SEMI_PRO', hours: 2, media: 'BOTH' },
    reel: 'birthday',
  },
  {
    id: 'cafe',
    tag: 'Small business',
    title: 'Opening a café or a brand?',
    body:
      'Menu shots for Swiggy and Zomato, product stills for your store and launch-week clips, ' +
      'all in one shoot.',
    preset: { category: 'FOOD', tier: 'PROFESSIONAL', hours: 2, media: 'BOTH' },
    reel: 'cafe',
  },
  {
    id: 'convocation',
    tag: 'Milestone',
    title: 'Convocation day',
    body:
      'Cap, gown, family and friends. Two hours on campus, so the day is not just blurry phone ' +
      'photos.',
    preset: { category: 'PORTRAIT', tier: 'BASIC', hours: 2, media: 'PHOTO' },
    reel: 'convocation',
  },
];

/** The "For creators" points (Terms §4.3 for video, §9.2–9.3 for usage). */
export const CREATOR_POINTS: readonly string[] = [
  'Photos and video in one booking, by the hour from 2 hours.',
  'Every clip comes unedited and camera-original, ready for your own edit, or add a paid reel edit.',
  'Personal and commercial use once paid: posts, ads and brand deals. Reselling as stock is not.',
  'KYC and police-verified photographers, and the price with GST before you pay.',
];
