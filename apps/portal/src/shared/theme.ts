import { baseCss } from './styles/base';
import { componentCss } from './styles/components';
import { screenCss } from './styles/screens';
import { rootCss } from './styles/vars';

/**
 * Portal stylesheet generated from design tokens: the white theme (ADR-0017, docs/DESIGN-LIGHT.md).
 * No raw colours anywhere else — add a class here (src/shared/styles) instead of an inline style.
 * Rendered once into a nonce'd <style> by the root layout (CSP, proxy.ts). Moves to
 * @clickco/ui-web (shadcn) with the admin rebuild in S9, as the console does.
 */
export function portalCss(): string {
  return [rootCss(), baseCss(), componentCss(), screenCss()].join('\n');
}
