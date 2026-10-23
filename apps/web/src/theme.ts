import { baseCss } from './styles/base';
import { componentsCss } from './styles/components';
import { layoutCss } from './styles/layout';
import { sectionsCss } from './styles/sections';

/** Site stylesheet generated from design tokens, so no raw values live in the app. */
export function siteCss(): string {
  return [baseCss(), layoutCss(), componentsCss(), sectionsCss()].join('\n');
}
