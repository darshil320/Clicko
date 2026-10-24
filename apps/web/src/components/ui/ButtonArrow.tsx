import { Icon } from './Icon';

/** The arrow disc at the end of a pill button (DESIGN-DAYLIGHT, Button). Decorative. */
export function ButtonArrow() {
  return (
    <span className="btn-arrow" aria-hidden="true">
      <Icon name="arrowRight" />
    </span>
  );
}
