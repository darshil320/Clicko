/**
 * Security review M6: the export worklist for one booking. A file that fails is reported and
 * excluded for the rest of the run, so one unreadable RAW never holds up the others; the caller
 * retries the failures later (each retry only sees what is still unexported).
 */
export interface ExportLoopDeps<T extends { readonly id: string }> {
  /** The next unexported files, never one of `exclude`. Empty ⇒ done. */
  readonly nextBatch: (exclude: readonly string[]) => Promise<readonly T[]>;
  readonly exportOne: (item: T) => Promise<void>;
  /** Alerting is best-effort: its own failure never stops the run. */
  readonly onFailure: (item: T, error: unknown) => Promise<void>;
}

export interface ExportLoopResult {
  readonly exported: number;
  readonly failed: readonly string[];
}

export async function runExportLoop<T extends { readonly id: string }>(
  deps: ExportLoopDeps<T>,
): Promise<ExportLoopResult> {
  const failed: string[] = [];
  let exported = 0;
  for (;;) {
    const batch = await deps.nextBatch(failed);
    if (batch.length === 0) return { exported, failed };
    for (const item of batch) {
      try {
        await deps.exportOne(item);
        exported += 1;
      } catch (error) {
        failed.push(item.id);
        await deps.onFailure(item, error).catch(() => undefined);
      }
    }
  }
}
