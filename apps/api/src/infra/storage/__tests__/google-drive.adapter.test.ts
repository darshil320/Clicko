import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { GoogleDriveAdapter } from '../adapters/google-drive.adapter';
import { StorageNotConfiguredError } from '../storage.errors';
import { MemoryUploadBudget } from '../upload-budget';

const clock = () => new Date();
const drive = new GoogleDriveAdapter(
  { sharedDriveId: null, serviceAccountJsonBase64: null },
  new MemoryUploadBudget(clock),
  clock,
);

describe('GoogleDriveAdapter (skeleton until PLAN B10)', () => {
  it('identifies as GOOGLE_DRIVE', () => {
    expect(drive.adapterId).toBe('GOOGLE_DRIVE');
  });

  it.each([
    ['createUploadSession', () => drive.createUploadSession({} as never)],
    ['uploadPart', () => drive.uploadPart('s', 1, [], { sizeBytes: 1, sha256: 'x' })],
    ['listParts', () => drive.listParts('s')],
    ['completeUpload', () => drive.completeUpload('s', 'x')],
    ['abortUpload', () => drive.abortUpload('s')],
    ['putObject', () => drive.putObject({} as never, [])],
    ['openObject', () => drive.openObject('o')],
    ['createDeliveryLink', () => drive.createDeliveryLink(randomUUID(), 'JPEG', new Date())],
    ['revokeDeliveryLink', () => drive.revokeDeliveryLink('l')],
    ['permanentlyDelete', () => drive.permanentlyDelete(['o'])],
    ['getUsage', () => drive.getUsage()],
    ['listObjects', () => drive.listObjects(randomUUID())],
  ])('%s throws StorageNotConfiguredError, naming the B10 gate', async (_name, call) => {
    const error = await call().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StorageNotConfiguredError);
    expect((error as Error).message).toMatch(/B10/);
  });

  // When the adapter is implemented, register it with describeStoragePortContract (same suite as
  // LocalDiskAdapter) against a sandbox Shared Drive.
  it.todo('passes the StoragePort contract suite against a sandbox Shared Drive (PLAN B10)');
});
