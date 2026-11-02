import { Icon } from './Icon';

/** The arrow disc at the end of the amber primary button only (ADR-0028 D4). Decorative. */
export function ButtonArrow() {
  return (
    <span className="btn-arrow" aria-hidden="true">
      <Icon name="arrowRight" />
    </span>
  );
}
