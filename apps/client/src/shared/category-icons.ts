import type { LucideIcon } from '@clickco/ui';
import Briefcase from 'lucide-react-native/icons/briefcase';
import Building from 'lucide-react-native/icons/building';
import Camera from 'lucide-react-native/icons/camera';
import Heart from 'lucide-react-native/icons/heart';
import Package from 'lucide-react-native/icons/package';
import PartyPopper from 'lucide-react-native/icons/party-popper';
import UserRound from 'lucide-react-native/icons/user-round';
import UtensilsCrossed from 'lucide-react-native/icons/utensils-crossed';

/** One glyph per launch category (shared by Home's category row and the bookings lists). */
const CATEGORY_ICON: Readonly<Record<string, LucideIcon>> = {
  FOOD: UtensilsCrossed,
  WEDDING: Heart,
  PORTRAIT: UserRound,
  PRODUCT: Package,
  EVENT: PartyPopper,
  REAL_ESTATE: Building,
  CORPORATE: Briefcase,
};

/** A camera for any category the catalogue does not list yet. */
export function categoryIcon(code: string): LucideIcon {
  return CATEGORY_ICON[code] ?? Camera;
}
