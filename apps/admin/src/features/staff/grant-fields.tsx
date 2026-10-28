'use client';

import { StaffRole } from '@clickco/contracts';
import {
  Field,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@clickco/ui-web';
import type { CityRef } from '../../shared/access';
import { formatCode } from '../../shared/format';
import { needsCity } from './rules';

const ALL_CITIES = 'all';

export interface GrantDraft {
  readonly role: StaffRole;
  /** A city's id from GET /admin/cities, or ALL. */
  readonly city: string;
}

export const EMPTY_GRANT: GrantDraft = { role: 'OPS_AGENT', city: ALL_CITIES };

/** The draft as the contract's grant body: `{ role, cityId }`. */
export function grantBody(draft: GrantDraft): { role: StaffRole; cityId: string | null } {
  return { role: draft.role, cityId: draft.city === ALL_CITIES ? null : draft.city };
}

/** Role + city for one grant. Cities come from GET /admin/cities. */
export function GrantFields({
  idPrefix,
  draft,
  cities,
  onChange,
  cityError,
}: {
  readonly idPrefix: string;
  readonly draft: GrantDraft;
  readonly cities: ReadonlyArray<CityRef>;
  readonly onChange: (next: GrantDraft) => void;
  readonly cityError?: string | null;
}) {
  const cityRequired = needsCity(draft.role);
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Role" htmlFor={`${idPrefix}-role`}>
        <Select
          value={draft.role}
          onValueChange={(value) => onChange({ ...draft, role: StaffRole.parse(value) })}
        >
          <SelectTrigger id={`${idPrefix}-role`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {StaffRole.options.map((role) => (
              <SelectItem key={role} value={role}>
                {formatCode(role)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field
        label={cityRequired ? 'City' : 'City (optional)'}
        htmlFor={`${idPrefix}-city`}
        error={cityError ?? null}
      >
        <Select value={draft.city} onValueChange={(city) => onChange({ ...draft, city })}>
          <SelectTrigger id={`${idPrefix}-city`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_CITIES}>Every city</SelectItem>
            {cities.map((city) => (
              <SelectItem key={city.cityId} value={city.cityId}>
                {city.cityName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
    </div>
  );
}
