import type { SessionDoc } from './session-doc';

/**
 * Declared vs received reconciliation before a job can be marked uploaded (doc 02 §7). Pure: the
 * session counters, the resumability document and the asset rows must all tell the same story.
 * Returns null when they agree, else the first disagreement (stored as the session's failure_reason).
 */
export function reconcileSession(
  session: {
    readonly declaredFileCount: number;
    readonly declaredBytes: number;
    readonly receivedFileCount: number;
    readonly receivedBytes: number;
    readonly doc: SessionDoc;
  },
  assets: ReadonlyArray<{ readonly id: string; readonly sizeBytes: number }>,
): string | null {
  const files = Object.values(session.doc.files);
  if (files.length !== session.declaredFileCount) {
    return `manifest lists ${files.length} files but ${session.declaredFileCount} were declared`;
  }
  if (session.receivedFileCount !== session.declaredFileCount) {
    return `received ${session.receivedFileCount} of ${session.declaredFileCount} declared files`;
  }
  if (session.receivedBytes !== session.declaredBytes) {
    return `received ${session.receivedBytes} of ${session.declaredBytes} declared bytes`;
  }
  if (assets.length !== session.declaredFileCount) {
    return `${assets.length} stored assets for ${session.declaredFileCount} declared files`;
  }
  const assetIds = new Set(assets.map((a) => a.id));
  const orphanFile = files.find(
    (f) => f.status !== 'VERIFIED' || !f.assetId || !assetIds.has(f.assetId),
  );
  if (orphanFile) return `file ${orphanFile.name} has no verified stored asset`;
  const storedBytes = assets.reduce((sum, a) => sum + a.sizeBytes, 0);
  if (storedBytes !== session.declaredBytes) {
    return `stored ${storedBytes} bytes for ${session.declaredBytes} declared`;
  }
  return null;
}
