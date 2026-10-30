import { Inject, Injectable } from '@nestjs/common';
import type postgres from 'postgres';
import { SQL } from '../../../infra/db/db.module';

/** Display names of staff members (the admin module owns staff_users). */
@Injectable()
export class StaffNames {
  constructor(@Inject(SQL) private readonly sql: postgres.Sql) {}

  async of(ids: ReadonlyArray<string | null>): Promise<Map<string, string>> {
    const wanted = [...new Set(ids.filter((id): id is string => id !== null))];
    if (wanted.length === 0) return new Map();
    const rows = await this.sql<{ id: string; full_name: string }[]>`
      SELECT id, full_name FROM staff_users WHERE id IN ${this.sql(wanted)}`;
    return new Map(rows.map((r) => [r.id, r.full_name]));
  }
}

/** { id, name } for the wire; the system when nobody signed in did it. */
export const actorOf = (id: string | null, names: ReadonlyMap<string, string>) => ({
  id,
  name: id ? (names.get(id) ?? 'A former staff member') : 'Clickco (automatic)',
});
