import { describe, expect, it } from 'vitest';
import { capacityProblem } from '../capacity';
import { compareInventory } from '../integrity-audit.service';
import { planQuotaAlerts, shareBps, storageBand } from '../quota-monitor.service';
import { reconcileSession } from '../reconcile';
import {
  buildSessionDoc,
  expectedPartSize,
  fileStates,
  missingParts,
  type SessionDoc,
  type SessionFileDoc,
  stagedFiles,
  unverifiedFiles,
} from '../session-doc';

const MIB = 1024 * 1024;
const PART = 8 * MIB;

function fileOf(d: SessionDoc, id: string): SessionFileDoc {
  const f = d.files[id];
  if (!f) throw new Error(`no file ${id}`);
  return f;
}

function doc(): SessionDoc {
  return buildSessionDoc({
    partSizeBytes: PART,
    declaredFrameCount: 2,
    checkoutDeclaredFrames: null,
    files: [
      {
        declaration: {
          clientFileId: 'raw1',
          name: 'IMG_1.CR3',
          kind: 'RAW_PHOTO',
          sizeBytes: 20 * MIB,
          lastModified: 5,
        },
        folder: 'Photos-RAW/part-01',
        storageSessionId: 's1',
      },
      {
        declaration: {
          clientFileId: 'jpg1',
          name: 'IMG_2.JPG',
          kind: 'JPEG_PHOTO',
          sizeBytes: 100,
          lastModified: 6,
        },
        folder: 'Photos-JPEG',
        storageSessionId: 's2',
      },
    ],
  });
}

describe('session document (upload state machine)', () => {
  it('plans 8 MiB parts with the remainder last', () => {
    const d = doc();
    const raw = d.files.raw1;
    expect(raw?.partCount).toBe(3);
    if (!raw) throw new Error('raw1 missing');
    expect([1, 2, 3].map((n) => expectedPartSize(raw, PART, n))).toEqual([PART, PART, 4 * MIB]);
    expect(d.files.jpg1?.partCount).toBe(1);
  });

  it('starts every file PENDING with no parts, and lists what is missing', () => {
    const d = doc();
    expect(unverifiedFiles(d).sort()).toEqual(['jpg1', 'raw1']);
    expect(missingParts(fileOf(d, 'raw1'))).toEqual([1, 2, 3]);
    const withParts = { ...fileOf(d, 'raw1'), parts: { '1': 'a'.repeat(64), '3': 'b'.repeat(64) } };
    expect(missingParts(withParts)).toEqual([2]);
  });

  it('renders the resume view sorted by name with numeric parts', () => {
    const d = doc();
    const resumed: SessionDoc = {
      ...d,
      files: {
        ...d.files,
        raw1: { ...fileOf(d, 'raw1'), parts: { '2': 'c'.repeat(64), '1': 'd'.repeat(64) } },
      },
    };
    const states = fileStates(resumed);
    expect(states.map((s) => s.name)).toEqual(['IMG_1.CR3', 'IMG_2.JPG']);
    expect(states[0]?.receivedParts.map((p) => p.partNumber)).toEqual([1, 2]);
    expect(states[0]?.status).toBe('PENDING');
  });

  it('the reaper reclaims only PENDING files holding parts (security review M5)', () => {
    const d = doc();
    expect(stagedFiles(d)).toEqual([]);
    const staged: SessionDoc = {
      ...d,
      files: {
        raw1: { ...fileOf(d, 'raw1'), parts: { '1': 'a'.repeat(64) } },
        jpg1: { ...fileOf(d, 'jpg1'), parts: { '1': 'b'.repeat(64) }, status: 'VERIFIED' },
      },
    };
    expect(stagedFiles(staged).map(([id]) => id)).toEqual(['raw1']);
  });
});

describe('reconcileSession (declared vs received)', () => {
  const verified = (): SessionDoc => {
    const d = doc();
    return {
      ...d,
      files: {
        raw1: { ...fileOf(d, 'raw1'), status: 'VERIFIED', assetId: 'A1', sha256: 'x' },
        jpg1: { ...fileOf(d, 'jpg1'), status: 'VERIFIED', assetId: 'A2', sha256: 'y' },
      },
    };
  };
  const base = {
    declaredFileCount: 2,
    declaredBytes: 20 * MIB + 100,
    receivedFileCount: 2,
    receivedBytes: 20 * MIB + 100,
  };
  const assets = [
    { id: 'A1', sizeBytes: 20 * MIB },
    { id: 'A2', sizeBytes: 100 },
  ];

  it('agrees when counts, bytes and asset rows line up', () => {
    expect(reconcileSession({ ...base, doc: verified() }, assets)).toBeNull();
  });

  it('flags every kind of disagreement', () => {
    expect(reconcileSession({ ...base, receivedFileCount: 1, doc: verified() }, assets)).toMatch(
      /received 1 of 2/,
    );
    expect(reconcileSession({ ...base, receivedBytes: 1, doc: verified() }, assets)).toMatch(
      /bytes/,
    );
    expect(reconcileSession({ ...base, doc: verified() }, assets.slice(0, 1))).toMatch(
      /1 stored assets/,
    );
    expect(
      reconcileSession({ ...base, doc: verified() }, [
        assets[0] as never,
        { id: 'ZZ', sizeBytes: 100 },
      ]),
    ).toMatch(/no verified stored asset/);
    expect(
      reconcileSession({ ...base, doc: verified() }, [
        assets[0] as never,
        { id: 'A2', sizeBytes: 99 },
      ]),
    ).toMatch(/stored/);
    expect(reconcileSession({ ...base, doc: doc() }, assets)).toMatch(/no verified stored asset/);
  });
});

describe('capacity (doc 02 §6: refuse past 85 % of the daily ceiling)', () => {
  const usage = { usedBytes: 0, limitBytes: 1_000, dailyUploadedBytes: 0, dailyLimitBytes: 1_000 };

  it('allows up to 85 % of the daily ceiling, refuses beyond', () => {
    expect(capacityProblem(usage, 850)).toBeNull();
    expect(capacityProblem(usage, 851)).toBe('STORAGE_DAILY_CEILING');
    expect(capacityProblem({ ...usage, dailyUploadedBytes: 800 }, 51)).toBe(
      'STORAGE_DAILY_CEILING',
    );
  });

  it('has no daily ceiling locally unless configured, but never overfills storage', () => {
    expect(capacityProblem({ ...usage, dailyLimitBytes: null }, 999)).toBeNull();
    expect(capacityProblem({ ...usage, dailyLimitBytes: null, usedBytes: 500 }, 501)).toBe(
      'STORAGE_FULL',
    );
  });

  it('reserves what other open sessions still have to send (security review M5)', () => {
    const local = { ...usage, dailyLimitBytes: null };
    expect(capacityProblem(local, 600, 400)).toBeNull();
    expect(capacityProblem(local, 600, 401)).toBe('STORAGE_FULL');
    expect(capacityProblem(usage, 450, 400)).toBeNull();
    expect(capacityProblem(usage, 451, 400)).toBe('STORAGE_DAILY_CEILING');
  });

  it('does not overflow on a 5 TB drive', () => {
    const tb5 = 5 * 1024 ** 4;
    expect(
      capacityProblem(
        { usedBytes: 0, limitBytes: tb5, dailyUploadedBytes: 0, dailyLimitBytes: 750e9 },
        700e9,
      ),
    ).toBe('STORAGE_DAILY_CEILING');
  });
});

describe('quota alerts (60 / 75 / 90 %, on the crossing only)', () => {
  const s = (used: number, daily = 0) => ({
    usedBytes: used,
    limitBytes: 10_000,
    dailyUploadedBytes: daily,
    dailyLimitBytes: 10_000,
  });

  it('computes shares in basis points without float error', () => {
    expect(shareBps(6_000, 10_000)).toBe(6_000);
    expect(shareBps(5 * 1024 ** 4, 5 * 1024 ** 4)).toBe(10_000);
    expect(shareBps(1, 0)).toBe(0);
    expect([5_999, 6_000, 7_500, 9_000, 9_999].map(storageBand)).toEqual([-1, 0, 1, 2, 2]);
  });

  it('alerts once per band crossed, with rising severity', () => {
    expect(planQuotaAlerts(null, s(5_000)).storage).toBeNull();
    expect(planQuotaAlerts(s(5_000), s(6_100)).storage).toEqual({
      severity: 'MEDIUM',
      thresholdBps: 6_000,
    });
    expect(planQuotaAlerts(s(6_100), s(6_200)).storage).toBeNull();
    expect(planQuotaAlerts(s(6_200), s(7_600)).storage?.severity).toBe('HIGH');
    expect(planQuotaAlerts(s(7_600), s(9_500)).storage?.severity).toBe('CRITICAL');
    expect(planQuotaAlerts(s(5_000), s(9_500)).storage?.severity).toBe('CRITICAL');
  });

  it('alerts when the daily ceiling crosses 85 %', () => {
    expect(planQuotaAlerts(s(0, 8_000), s(0, 8_600)).daily).toBe(true);
    expect(planQuotaAlerts(s(0, 8_600), s(0, 8_700)).daily).toBe(false);
    expect(planQuotaAlerts(null, { ...s(0, 9_000), dailyLimitBytes: null }).daily).toBe(false);
  });
});

describe('compareInventory (weekly integrity audit)', () => {
  const db = [
    { storageObjectId: 'o1', sizeBytes: 10, checksumMd5: 'm1' },
    { storageObjectId: 'o2', sizeBytes: 20, checksumMd5: 'm2' },
  ];
  const provider = [
    { objectId: 'o1', sizeBytes: 10, md5: 'm1' },
    { objectId: 'o2', sizeBytes: 20, md5: 'm2' },
  ];

  it('is OK when declared, stored and provider agree', () => {
    expect(
      compareInventory({
        declared: 2,
        purgedOriginals: 0,
        storedOriginals: 2,
        dbAssets: db,
        provider,
      }),
    ).toMatchObject({
      result: 'OK',
      expectedCount: 2,
      dbCount: 2,
      providerCount: 2,
      checksumMismatches: 0,
    });
  });

  it('finds missing, orphaned and corrupted objects and short counts', () => {
    const r = compareInventory({
      declared: 3,
      purgedOriginals: 0,
      storedOriginals: 2,
      dbAssets: db,
      provider: [
        { objectId: 'o1', sizeBytes: 10, md5: 'BAD' },
        { objectId: 'o9', sizeBytes: 1, md5: 'x' },
      ],
    });
    expect(r).toMatchObject({
      result: 'MISMATCH',
      expectedCount: 3,
      missing: ['o2'],
      orphans: ['o9'],
      mismatched: ['o1'],
    });
  });

  it('does not expect purged originals', () => {
    expect(
      compareInventory({
        declared: 3,
        purgedOriginals: 1,
        storedOriginals: 2,
        dbAssets: db,
        provider,
      }).result,
    ).toBe('OK');
  });
});
