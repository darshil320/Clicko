/**
 * The real SDKs (packages/api-client) and contracts, imported from source so the dry run speaks
 * exactly what the apps speak. Routes the SDKs do not wrap (the portal's upload routes, the
 * client's delivery view, the public listing, the dev views) go through `rawCall`, which uses the
 * SDK's own envelope unwrapping and error type.
 */
import { unwrapEnvelope } from '../../packages/api-client/src/index.js';

export {
  type AdminApiClient,
  type ApiClient,
  ApiError,
  createAdminApiClient,
  createApiClient,
  createProApiClient,
  isApiError,
  newIdempotencyKey,
  type ProApiClient,
  type TokenStore,
} from '../../packages/api-client/src/index.js';
export {
  AbortUploadSessionResponse,
  CompleteUploadFileResponse,
  CompleteUploadSessionResponse,
  DeliveryFolderView,
  DeliveryView,
  DispatchDeskView,
  UploadPartResponse,
  UploadSessionView,
} from '../../packages/contracts/src/index.js';

/** The contract schema type the SDK validates with (zod's, without importing zod here). */
type Schema<T> = Parameters<typeof unwrapEnvelope<T>>[2];

export interface RawRequest<T> {
  readonly method: 'GET' | 'POST' | 'PUT';
  readonly path: string;
  readonly schema: Schema<T>;
  readonly token?: string | null;
  readonly json?: unknown;
  readonly bytes?: Uint8Array;
  readonly headers?: Readonly<Record<string, string>>;
  readonly idempotencyKey?: string;
}

const TIMEOUT_MS = 30_000;

export async function rawCall<T>(baseUrl: string, req: RawRequest<T>): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json', ...req.headers };
  if (req.token) headers.authorization = `Bearer ${req.token}`;
  if (req.idempotencyKey) headers['idempotency-key'] = req.idempotencyKey;
  let body: string | Uint8Array<ArrayBuffer> | undefined;
  if (req.json !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(req.json);
  } else if (req.bytes !== undefined) {
    headers['content-type'] = 'application/octet-stream';
    body = new Uint8Array(req.bytes);
  }
  const response = await fetch(`${baseUrl}${req.path}`, {
    method: req.method,
    headers,
    ...(body === undefined ? {} : { body }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = text === '' ? null : JSON.parse(text);
  } catch {
    parsed = {
      success: false,
      data: null,
      error: { code: 'NOT_JSON', message: text.slice(0, 200) },
    };
  }
  return unwrapEnvelope(response.status, parsed, req.schema);
}

/** GET a file's bytes (a delivery download). */
export async function rawBytes(baseUrl: string, path: string): Promise<Uint8Array> {
  const response = await fetch(`${baseUrl}${path}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (response.status !== 200) throw new Error(`GET ${path} answered HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}
