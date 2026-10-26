import { baseCss } from './styles/base';
import { componentsCss } from './styles/components';
import { formsCss } from './styles/forms';
import { heroCss } from './styles/hero';
import { layoutCss } from './styles/layout';
import { momentsCss } from './styles/moments';
import { motionCss } from './styles/motion';
import { photoCss } from './styles/photo';
import { sectionsCss } from './styles/sections';

/** Site stylesheet generated from design tokens (Daylight, ADR-0018), so no raw values live in the app. */
export function siteCss(): string {
  return [
    baseCss(),
    layoutCss(),
    componentsCss(),
    photoCss(),
    heroCss(),
    momentsCss(),
    sectionsCss(),
    formsCss(),
    motionCss(),
  ].join('\n');
}
