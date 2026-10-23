/**
 * Adapter-agnostic storage failures. Callers branch on the class (or `code`), never on a provider's
 * own error type — that is what keeps a Drive → R2 swap invisible above infra/storage.
 */
export class StorageError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** The adapter cannot be used here (Drive before PLAN B10). */
export class StorageNotConfiguredError extends StorageError {
  constructor(message: string) {
    super('STORAGE_NOT_CONFIGURED', message);
  }
}

/** No such upload session (never created, aborted, completed, or expired). */
export class StorageSessionNotFoundError extends StorageError {
  constructor(sessionId: string) {
    super('STORAGE_SESSION_NOT_FOUND', `Upload session ${sessionId} does not exist`);
  }
}

/** No such object or link. */
export class StorageNotFoundError extends StorageError {
  constructor(what: string) {
    super('STORAGE_NOT_FOUND', `${what} does not exist`);
  }
}

/** Input the adapter refuses before touching anything (bad part number, unsafe path, …). */
export class StorageInvalidInputError extends StorageError {
  constructor(message: string) {
    super('STORAGE_INVALID_INPUT', message);
  }
}

/** A part's byte count differs from what was declared. Nothing was kept. */
export class PartSizeMismatchError extends StorageError {
  constructor(
    readonly expectedBytes: number,
    readonly receivedBytes: number,
  ) {
    super(
      'PART_SIZE_MISMATCH',
      `Part should be ${expectedBytes} bytes but ${receivedBytes} were received`,
    );
  }
}

/** A part's hash differs from the one the client sent. Nothing was kept. */
export class PartChecksumMismatchError extends StorageError {
  constructor() {
    super('PART_CHECKSUM_MISMATCH', 'The part does not match its checksum');
  }
}

/** completeUpload before every part has landed. */
export class MissingPartsError extends StorageError {
  constructor(readonly missingParts: readonly number[]) {
    super('MISSING_PARTS', `Parts still missing: ${missingParts.slice(0, 20).join(', ')}`);
  }
}

/** The assembled file does not match the client's whole-file SHA-256. Its parts were discarded. */
export class ChecksumMismatchError extends StorageError {
  constructor() {
    super('CHECKSUM_MISMATCH', 'The file does not match its checksum');
  }
}
