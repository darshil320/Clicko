import type { CategoryCode } from './rate-card';

/**
 * Licensed sample reels (ADR-0023): Pexels licence, self-hosted under public/reels as 720×1280
 * MP4 loops (no audio) with a JPEG poster, and credited here. Clickco's own reels replace them
 * file for file.
 */
export interface SiteReel {
  readonly name: string;
  readonly src: string;
  readonly poster: string;
  /** What happens in the clip. */
  readonly alt: string;
  readonly credit: { readonly creator: string; readonly page: string };
}

const reel = (name: string, alt: string, creator: string, page: string): SiteReel => ({
  name,
  src: `/reels/${name}.mp4`,
  poster: `/reels/${name}.jpg`,
  alt,
  credit: { creator, page },
});

export const REELS: Readonly<Record<string, SiteReel>> = {
  hero: reel(
    'hero',
    "A videographer's camera on a gimbal frames a woman in a lilac dress posing outdoors, with her pose showing on the camera screen.",
    'Ventara Films / Pexels',
    'https://www.pexels.com/video/photographer-captures-model-outdoors-in-nature-38758222/',
  ),
  'new-city': reel(
    'new-city',
    'A woman in a flowing pink dress twirls beside the reflecting pool in front of the Taj Mahal.',
    'DARKMODE CINEMA / Pexels',
    'https://www.pexels.com/video/a-woman-in-a-pink-dress-is-standing-in-front-of-the-taj-mahal-18286339/',
  ),
  proposal: reel(
    'proposal',
    'A man on one knee in a garden offers a ring to a surprised woman and slips it onto her finger.',
    'RingTheBell.com Task Manager / Pexels',
    'https://www.pexels.com/video/proposal-26761234/',
  ),
  creator: reel(
    'creator',
    'A young woman presents her outfit to a phone on a tripod in front of a ring light, with a clothes rack behind her.',
    'Liza Summer / Pexels',
    'https://www.pexels.com/video/woman-vlogging-in-front-of-ring-light-6342209/',
  ),
  birthday: reel(
    'birthday',
    'Friends raise paper cups and cheer as gold confetti rains down at an indoor birthday party.',
    'Pavel Danilyuk / Pexels',
    'https://www.pexels.com/video/video-of-people-celebrating-7119932/',
  ),
  cafe: reel(
    'cafe',
    'A barista pours steamed milk into a cup of espresso, drawing a latte art pattern.',
    'Esra Afşar / Pexels',
    'https://www.pexels.com/video/latte-art-creation-in-a-coffee-shop-34601853/',
  ),
  convocation: reel(
    'convocation',
    'Graduates in black gowns toss their caps into the air inside a school gym.',
    'Pavel Danilyuk / Pexels',
    'https://www.pexels.com/video/graduates-throwing-academic-cap-on-air-7945811/',
  ),
  'wedding-reel': reel(
    'wedding-reel',
    'A bride in yellow at her haldi ceremony throws marigold petals into the air and lets them shower over her.',
    'Om Dixit / Pexels',
    'https://www.pexels.com/video/bride-during-haldi-ceremony-15670051/',
  ),
};

/** The reel the hero shows when video is chosen for a category; the rest use the hero reel. */
export const CATEGORY_REEL: Readonly<Partial<Record<CategoryCode, string>>> = {
  FOOD: 'cafe',
  WEDDING: 'wedding-reel',
  EVENT: 'birthday',
};

/** The reels wall, in order. */
export const REEL_WALL: readonly { readonly reel: string; readonly label: string }[] = [
  { reel: 'proposal', label: 'Proposal' },
  { reel: 'creator', label: 'Creator day' },
  { reel: 'wedding-reel', label: 'Wedding' },
  { reel: 'new-city', label: 'Travel' },
  { reel: 'birthday', label: 'Birthday' },
  { reel: 'cafe', label: 'Café launch' },
  { reel: 'convocation', label: 'Convocation' },
];
