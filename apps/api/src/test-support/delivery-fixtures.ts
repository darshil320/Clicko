import { createHash } from 'node:crypto';
import { MEDIA_LIMITS } from '@clickco/contracts';
import { PaymentFlowService } from '../modules/checkout/payment-flow.service';
import { PAYMENT_GATEWAY } from '../modules/payments/gateways/payment-gateway.port';
import { SandboxGateway } from '../modules/payments/gateways/sandbox.gateway';
import type { E2eApp, Json } from './e2e-app';

const sha256 = (b: Buffer): string => createHash('sha256').update(b).digest('hex');

/** Pays whatever the booking owes now (advance or balance) through a signed sandbox webhook. */
export async function payWhatIsDue(
  e2e: E2eApp,
  userId: string,
  bookingId: string,
): Promise<{ paymentId: string; amountPaise: number; outcome: string }> {
  const flow = e2e.get(PaymentFlowService);
  const pay = await flow.pay(userId, bookingId);
  const gateway = e2e.get(PAYMENT_GATEWAY);
  if (!(gateway instanceof SandboxGateway)) throw new Error('payWhatIsDue needs the sandbox');
  const hook = gateway.buildWebhook({
    providerOrderId: pay.providerOrderId,
    amountPaise: BigInt(pay.amountPaise),
    event: 'payment.captured',
  });
  const outcome = await flow.handleWebhook({
    provider: gateway.routeSlug,
    rawBody: hook.rawBody,
    signature: hook.signature,
    eventId: hook.eventId,
  });
  return { paymentId: pay.paymentId, amountPaise: pay.amountPaise, outcome };
}

export interface UploadFile {
  readonly clientFileId: string;
  readonly name: string;
  readonly kind: 'RAW_PHOTO' | 'JPEG_PHOTO';
  readonly bytes: Buffer;
}

/** Opens a session, sends every part, verifies every file and completes the session. */
export async function uploadAll(
  e2e: E2eApp,
  proToken: string,
  bookingId: string,
  files: readonly UploadFile[],
  declaredFrameCount: number,
): Promise<string> {
  let n = 0;
  const key = () => `delivery-upload-${bookingId}-${++n}`;
  const opened = await e2e.call('POST', `/pro/bookings/${bookingId}/upload-sessions`, {
    token: proToken,
    idempotencyKey: key(),
    body: {
      files: files.map((f) => ({
        clientFileId: f.clientFileId,
        name: f.name,
        sizeBytes: f.bytes.length,
        kind: f.kind,
        lastModified: 1_700_000_000_000,
      })),
      declaredFrameCount,
    },
  });
  if (opened.status !== 201) throw new Error(`open failed: ${JSON.stringify(opened.json)}`);
  const sessionId = opened.json.data.sessionId as string;
  const part = MEDIA_LIMITS.partSizeBytes;
  for (const f of files) {
    for (let i = 1; (i - 1) * part < f.bytes.length; i++) {
      const chunk = f.bytes.subarray((i - 1) * part, i * part);
      const put = await e2e.call(
        'PUT',
        `/pro/upload-sessions/${sessionId}/files/${f.clientFileId}/parts/${i}`,
        {
          token: proToken,
          rawBody: chunk,
          headers: { 'content-type': 'application/octet-stream', 'x-part-sha256': sha256(chunk) },
        },
      );
      if (put.status !== 200) throw new Error(`part failed: ${JSON.stringify(put.json)}`);
    }
    const done = await e2e.call(
      'POST',
      `/pro/upload-sessions/${sessionId}/files/${f.clientFileId}/complete`,
      { token: proToken, idempotencyKey: key(), body: { sha256: sha256(f.bytes) } },
    );
    if (done.status !== 200) throw new Error(`complete failed: ${JSON.stringify(done.json)}`);
  }
  const closed = await e2e.call('POST', `/pro/upload-sessions/${sessionId}/complete`, {
    token: proToken,
    idempotencyKey: key(),
  });
  if (closed.status !== 200)
    throw new Error(`session failed: ${JSON.stringify(closed.json as Json)}`);
  return sessionId;
}
