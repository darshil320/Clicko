import { Logger } from '@nestjs/common';
import type postgres from 'postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StoragePort } from '../../../infra/storage/storage.port';
import { KYC_EVENTS, KYC_RETENTION, kycPurgeAfter } from '../kyc-retention.config';
import { KycRetentionService } from '../kyc-retention.service';
import type { DuePurge, KycRepository } from '../repositories/kyc.repository';

// 14 Nov 2026, 20:00 IST.
const NOW = new Date('2026-11-14T14:30:00.000Z');

interface EventCall {
  readonly text: string;
  readonly values: readonly unknown[];
}

/** A transaction stand-in: records every tagged-template query (appendDomainEvent's INSERT). */
function fakeTx(): { tx: postgres.TransactionSql; calls: EventCall[] } {
  const calls: EventCall[] = [];
  const fn = (strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ text: strings.join('?'), values });
    return Promise.resolve([]);
  };
  const tx = Object.assign(fn, { json: (v: unknown) => v }) as unknown as postgres.TransactionSql;
  return { tx, calls };
}

const eventTypes = (calls: readonly EventCall[]) =>
  calls.filter((c) => c.text.includes('INSERT INTO domain_events')).map((c) => c.values[0]);

function fakeStorage(failing: ReadonlySet<string> = new Set()) {
  const deleted: string[] = [];
  const storage = {
    permanentlyDelete: vi.fn(async (ids: readonly string[]) => {
      for (const id of ids) {
        if (failing.has(id)) throw new Error(`provider refused ${id} (KYC-SECRET-NAME.pdf)`);
        deleted.push(id);
      }
    }),
  } as unknown as StoragePort;
  return { storage, deleted };
}

function service(repo: Partial<KycRepository>, storage: StoragePort, tx: postgres.TransactionSql) {
  const sql = {
    begin: (fn: (t: postgres.TransactionSql) => Promise<unknown>) => fn(tx),
  } as unknown as postgres.Sql;
  return new KycRetentionService(sql, repo as KycRepository, storage, () => NOW);
}

describe('KYC retention config', () => {
  it('keeps documents 180 days after the relationship ends (no period stated in the docs)', () => {
    expect(KYC_RETENTION.daysAfterRelationshipEnds).toBe(180);
    expect(KYC_RETENTION.daysAfterApplicationClosed).toBe(180);
    expect(KYC_RETENTION.purgeBatch).toBeGreaterThan(0);
  });

  it('purge_after is the IST calendar day plus the retention days', () => {
    expect(kycPurgeAfter(NOW, 180)).toBe('2027-05-13');
    // 23:59 IST on 31 Dec: the IST day is 31 Dec.
    expect(kycPurgeAfter(new Date('2026-12-31T18:29:00.000Z'), 1)).toBe('2027-01-01');
    // 00:30 IST on 1 Jan: the IST day is 1 Jan, though UTC is still 31 Dec.
    expect(kycPurgeAfter(new Date('2026-12-31T19:00:00.000Z'), 1)).toBe('2027-01-02');
  });
});

describe('KycRetentionService.schedule / cancel', () => {
  it('sets purge_after on unpurged documents and emits the event in the same transaction', async () => {
    const { tx, calls } = fakeTx();
    const schedulePurge = vi.fn(async () => 3);
    const svc = service({ schedulePurge }, fakeStorage().storage, tx);
    const n = await svc.schedule(tx, { photographerId: 'p1', reason: 'OFFBOARDED', now: NOW });
    expect(n).toBe(3);
    expect(schedulePurge).toHaveBeenCalledWith(tx, 'p1', kycPurgeAfter(NOW, 180));
    expect(eventTypes(calls)).toEqual([KYC_EVENTS.SCHEDULED]);
  });

  it('emits nothing when there was no document to schedule', async () => {
    const { tx, calls } = fakeTx();
    const svc = service({ schedulePurge: vi.fn(async () => 0) }, fakeStorage().storage, tx);
    await svc.schedule(tx, { photographerId: 'p1', reason: 'APPLICATION_REJECTED', now: NOW });
    expect(eventTypes(calls)).toEqual([]);
  });

  it('cancel clears a pending purge and emits the cancellation only when something changed', async () => {
    const { tx, calls } = fakeTx();
    const cancelPurge = vi.fn(async () => 2);
    const svc = service({ cancelPurge }, fakeStorage().storage, tx);
    expect(await svc.cancel(tx, { photographerId: 'p1', now: NOW })).toBe(2);
    expect(cancelPurge).toHaveBeenCalledWith(tx, 'p1');
    expect(eventTypes(calls)).toEqual([KYC_EVENTS.CANCELLED]);

    const quiet = fakeTx();
    const none = service({ cancelPurge: vi.fn(async () => 0) }, fakeStorage().storage, quiet.tx);
    await none.cancel(quiet.tx, { photographerId: 'p1', now: NOW });
    expect(eventTypes(quiet.calls)).toEqual([]);
  });
});

describe('KycRetentionService.sweep', () => {
  afterEach(() => vi.restoreAllMocks());

  const due = (id: string): DuePurge => ({
    id,
    photographerId: `pro-${id}`,
    kind: 'PAN_CARD',
    storageKey: `obj-${id}`,
  });

  it('deletes each due file through StoragePort, then marks it purged with an event', async () => {
    const { tx, calls } = fakeTx();
    const { storage, deleted } = fakeStorage();
    const markPurged = vi.fn(async () => true);
    const svc = service(
      {
        dueForPurge: vi.fn(async () => [due('a'), due('b')]),
        lockDueForPurge: vi.fn(async (_tx: unknown, id: string) => due(id)),
        markPurged,
      },
      storage,
      tx,
    );
    const result = await svc.sweep();
    expect(result).toEqual({ purged: 2, failed: 0 });
    expect(deleted).toEqual(['obj-a', 'obj-b']);
    expect(markPurged).toHaveBeenCalledWith(tx, 'a', NOW);
    expect(eventTypes(calls)).toEqual([KYC_EVENTS.PURGED, KYC_EVENTS.PURGED]);
  });

  it('asks for at most one batch of documents due on the IST day', async () => {
    const { tx } = fakeTx();
    const dueForPurge = vi.fn(async () => []);
    const svc = service({ dueForPurge }, fakeStorage().storage, tx);
    await svc.sweep();
    expect(dueForPurge).toHaveBeenCalledWith(
      expect.anything(),
      '2026-11-14',
      KYC_RETENTION.purgeBatch,
    );
  });

  it('one failing file does not stop the batch, and the log carries no file name or key', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    const { tx, calls } = fakeTx();
    const { storage, deleted } = fakeStorage(new Set(['obj-b']));
    const markPurged = vi.fn(async () => true);
    const svc = service(
      {
        dueForPurge: vi.fn(async () => [due('a'), due('b'), due('c')]),
        lockDueForPurge: vi.fn(async (_tx: unknown, id: string) => due(id)),
        markPurged,
      },
      storage,
      tx,
    );
    expect(await svc.sweep()).toEqual({ purged: 2, failed: 1 });
    expect(deleted).toEqual(['obj-a', 'obj-c']);
    expect(markPurged).not.toHaveBeenCalledWith(tx, 'b', NOW);
    expect(eventTypes(calls)).toEqual([KYC_EVENTS.PURGED, KYC_EVENTS.PURGED]);
    const logged = warn.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).toContain('document b');
    expect(logged).not.toContain('obj-b');
    expect(logged).not.toContain('KYC-SECRET-NAME');
  });

  it('skips a document that is no longer due when locked (reopened, or purged by another run)', async () => {
    const { tx, calls } = fakeTx();
    const { storage, deleted } = fakeStorage();
    const markPurged = vi.fn(async () => true);
    const svc = service(
      {
        dueForPurge: vi.fn(async () => [due('a')]),
        lockDueForPurge: vi.fn(async () => null),
        markPurged,
      },
      storage,
      tx,
    );
    expect(await svc.sweep()).toEqual({ purged: 0, failed: 0 });
    expect(deleted).toEqual([]);
    expect(markPurged).not.toHaveBeenCalled();
    expect(eventTypes(calls)).toEqual([]);
  });
});
