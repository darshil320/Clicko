import { LEGAL, unresolvedFields } from './legal/config';

/** Visible only while fields are unresolved; production builds refuse to ship in that state. */
export function DraftNotice() {
  const pending = unresolvedFields(LEGAL);
  if (pending.length === 0) return null;
  return (
    <p className="draft">Draft — pending legal review and confirmation of: {pending.join(', ')}.</p>
  );
}
