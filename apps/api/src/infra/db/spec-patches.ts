/**
 * Corrections applied to docs/clickco-04-schema.sql when producing migration 0001.
 *
 * The spec file is read-only to agents and stays the source of truth; when it
 * cannot be applied to Postgres as written, the minimal fix is recorded here as
 * data, logged in docs/SPEC-AUDIT.md, and the drift test verifies
 * `0001 === applySpecPatches(spec)`. When Darshil updates the spec, the patch
 * is deleted and the test keeps passing only if the spec now carries the fix.
 */
export interface SpecPatch {
  readonly finding: string;
  readonly reason: string;
  readonly find: string;
  readonly replace: string;
}

export const SPEC_PATCHES: readonly SpecPatch[] = [
  {
    finding: 'SA-11',
    reason:
      'Postgres rejects timestamptz + interval in a generated column ("generation expression ' +
      'is not immutable"). Adding whole minutes is timezone-independent, so an IMMUTABLE ' +
      'wrapper is correct.',
    find: 'CREATE OR REPLACE FUNCTION set_updated_at()',
    replace:
      'CREATE OR REPLACE FUNCTION clickco_add_minutes(ts timestamptz, mins integer)\n' +
      'RETURNS timestamptz LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$\n' +
      "  SELECT ts + mins * interval '1 minute'\n" +
      '$$;\n\n' +
      'CREATE OR REPLACE FUNCTION set_updated_at()',
  },
  {
    finding: 'SA-11',
    reason: 'Use the immutable wrapper for bookings.scheduled_end.',
    find: '(scheduled_start + make_interval(mins => (scheduled_hours * 60)::int)) STORED',
    replace: '(clickco_add_minutes(scheduled_start, (scheduled_hours * 60)::int)) STORED',
  },
];

export function applySpecPatches(
  specSql: string,
  patches: readonly SpecPatch[] = SPEC_PATCHES,
): string {
  return patches.reduce((sql, patch) => {
    const occurrences = sql.split(patch.find).length - 1;
    if (occurrences !== 1) {
      throw new Error(
        `Spec patch for ${patch.finding} expected exactly one match, found ${occurrences}. ` +
          'The spec has changed — re-check the patch.',
      );
    }
    // Replacer function: a string replacement would interpret `$$` as an escape.
    return sql.replace(patch.find, () => patch.replace);
  }, specSql);
}
