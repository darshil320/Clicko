import { baseCss } from './styles/base';
import { componentsCss } from './styles/components';
import { formsCss } from './styles/forms';
import { heroCss } from './styles/hero';
import { layoutCss } from './styles/layout';
import { motionCss } from './styles/motion';
import { sectionsCss } from './styles/sections';

/** Site stylesheet generated from design tokens (white theme, ADR-0017), so no raw values live in the app. */
export function siteCss(): string {
  return [
    baseCss(),
    layoutCss(),
    componentsCss(),
    heroCss(),
    sectionsCss(),
    formsCss(),
    motionCss(),
  ].join('\n');
}
