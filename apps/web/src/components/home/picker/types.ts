import type { ShootMedia } from '../../../content/moments';
import type { SitePhoto } from '../../../content/photos';
import type { BookableTier, CategoryCode, LaunchCityTier } from '../../../content/rate-card';

export interface PickerCategory {
  readonly code: CategoryCode;
  readonly label: string;
  readonly recommended: BookableTier;
  readonly photo: SitePhoto;
  /** The sample reel shown when video is chosen for this category, if it has its own. */
  readonly reel?: string;
}

export interface PickerCity {
  readonly slug: string;
  readonly name: string;
  readonly tier: LaunchCityTier;
  readonly pilot: boolean;
  /** This city's page for each category. */
  readonly links: Readonly<Record<CategoryCode, string>>;
}

export interface PickerTier {
  readonly code: BookableTier;
  readonly label: string;
}

/** Everything the picker has chosen. Updated immutably; one object so a preset is one step. */
export interface Shoot {
  readonly media: ShootMedia;
  readonly category: CategoryCode;
  readonly city: string;
  readonly tier: BookableTier;
  readonly hours: number;
  /** The sample reel on show when video is chosen (a moment's own, else the hero reel). */
  readonly reel: string;
}

/** What a moment's "Book this" link sets; the city is left as the visitor chose it. */
export type ShootPreset = Pick<Shoot, 'media' | 'category' | 'tier' | 'hours' | 'reel'>;
