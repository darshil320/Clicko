import { describe, expect, it } from 'vitest';
import { runExportLoop } from '../export/export-loop';

/** A worklist like rawWithoutExport: everything not yet exported and not excluded, in order. */
function worklist(names: readonly string[], batch = 2) {
  const done = new Set<string>();
  return {
    done,
    nextBatch: async (exclude: readonly string[]) =>
      names
        .filter((n) => !done.has(n) && !exclude.includes(n))
        .slice(0, batch)
        .map((id) => ({ id })),
  };
}

describe('runExportLoop (security review M6: one bad RAW never stalls the booking)', () => {
  it('exports everything when nothing fails', async () => {
    const w = worklist(['a', 'b', 'c']);
    const result = await runExportLoop({
      nextBatch: w.nextBatch,
      exportOne: async ({ id }) => {
        w.done.add(id);
      },
      onFailure: async () => undefined,
    });
    expect(result).toEqual({ exported: 3, failed: [] });
  });

  it('skips a failing file for the rest of the run and exports the others', async () => {
    const w = worklist(['a-bad', 'b', 'c-bad', 'd']);
    const reported: string[] = [];
    const result = await runExportLoop({
      nextBatch: w.nextBatch,
      exportOne: async ({ id }) => {
        if (id.endsWith('-bad')) throw new Error(`cannot read ${id}`);
        w.done.add(id);
      },
      onFailure: async ({ id }) => {
        reported.push(id);
      },
    });
    expect(result).toEqual({ exported: 2, failed: ['a-bad', 'c-bad'] });
    expect(reported).toEqual(['a-bad', 'c-bad']);
    expect([...w.done]).toEqual(['b', 'd']);
  });

  it('a failing failure report does not stop the run', async () => {
    const w = worklist(['a-bad', 'b']);
    const result = await runExportLoop({
      nextBatch: w.nextBatch,
      exportOne: async ({ id }) => {
        if (id === 'a-bad') throw new Error('bad');
        w.done.add(id);
      },
      onFailure: async () => {
        throw new Error('alert store down');
      },
    });
    expect(result).toEqual({ exported: 1, failed: ['a-bad'] });
  });
});
