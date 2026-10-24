import { colorLight } from '@clickco/design-tokens';

/**
 * The palette for props that need a colour VALUE rather than a class (icon strokes, the
 * placeholder, switch tracks, navigation chrome). ADR-0017: the client app — this package's
 * consumer — is white, so values come from `colorLight`; classes come from the app's
 * `lightTailwindPreset`, which has the same token names.
 */
export const palette = colorLight;
