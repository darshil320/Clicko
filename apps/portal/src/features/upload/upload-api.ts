import { ApiError } from '@clickco/api-client';
import {
  AbortUploadSessionResponse,
  CompleteUploadFileResponse,
  CompleteUploadSessionResponse,
  type CreateUploadSessionBody,
  UploadPartResponse,
  UploadSessionView,
} from '@clickco/contracts';
import { api, isAbort } from '../../shared/api';
import { AbortedError } from './plan';
import { UploadHttpError, type UploadTransport } from './uploader';

const toUploadError = (error: unknown): unknown => {
  if (isAbort(error)) return new AbortedError();
  if (error instanceof ApiError) {
    return new UploadHttpError(error.status, error.code, error.message, error.details);
  }
  return error;
};

const call = async <T>(fn: () => Promise<T>): Promise<T> => {
  try {
    return await fn();
  } catch (error) {
    throw toUploadError(error);
  }
};

export const createUploadSession = (
  bookingId: string,
  body: CreateUploadSessionBody,
  idempotencyKey: string,
) =>
  api({
    method: 'POST',
    path: `/pro/bookings/${encodeURIComponent(bookingId)}/upload-sessions`,
    schema: UploadSessionView,
    json: body,
    idempotencyKey,
    auth: true,
  });

export const getUploadSession = (sessionId: string) =>
  api({
    method: 'GET',
    path: `/pro/upload-sessions/${encodeURIComponent(sessionId)}`,
    schema: UploadSessionView,
    auth: true,
  });

export const abortUploadSession = (sessionId: string, idempotencyKey: string) =>
  api({
    method: 'POST',
    path: `/pro/upload-sessions/${encodeURIComponent(sessionId)}/abort`,
    schema: AbortUploadSessionResponse,
    idempotencyKey,
    auth: true,
  });

/** The uploader's transport over the real API (ADR-0014 D2 routes). */
export const httpUploadTransport: UploadTransport = {
  putPart: (sessionId, fileId, partNumber, bytes, sha256, signal) =>
    call(() =>
      api({
        method: 'PUT',
        path: `/pro/upload-sessions/${encodeURIComponent(sessionId)}/files/${encodeURIComponent(fileId)}/parts/${partNumber}`,
        schema: UploadPartResponse,
        bytes,
        headers: { 'x-part-sha256': sha256 },
        auth: true,
        signal,
      }),
    ),
  completeFile: (sessionId, fileId, sha256, idempotencyKey, signal) =>
    call(() =>
      api({
        method: 'POST',
        path: `/pro/upload-sessions/${encodeURIComponent(sessionId)}/files/${encodeURIComponent(fileId)}/complete`,
        schema: CompleteUploadFileResponse,
        json: { sha256 },
        idempotencyKey,
        auth: true,
        signal,
      }),
    ),
  completeSession: (sessionId, idempotencyKey, signal) =>
    call(() =>
      api({
        method: 'POST',
        path: `/pro/upload-sessions/${encodeURIComponent(sessionId)}/complete`,
        schema: CompleteUploadSessionResponse,
        idempotencyKey,
        auth: true,
        signal,
      }),
    ),
};
