/**
 * Steps 12–18: check-out (real time: the booked hours must have passed), the portal upload,
 * JPEG export, staff QA through the admin SDK, the balance, the delivery link and the review.
 */
import { createHash } from 'node:crypto';
import { type RunContext, type Step, sleep, waitFor } from './context.js';
import { StepNotYet } from './report.js';
import { DeliveryFolderView, DeliveryView, newIdempotencyKey, rawBytes, rawCall } from './sdk.js';
import { signInStaff } from './sessions.js';
import { fix } from './steps-booking.js';
import { FRAME_COUNT, syntheticCard, uploadCard } from './upload.js';

const bookingStatus = async (ctx: RunContext) =>
  (await ctx.client.bookings.get(ctx.need('bookingId'))).booking.status;

const checkOut: Step = {
  id: 'check-out',
  name: 'check-out',
  async run(ctx) {
    const assignmentId = ctx.need('assignmentId');
    const detail = await ctx.pro.assignments.get(assignmentId);
    const earliest = detail.earliestCheckOutAt ? Date.parse(detail.earliestCheckOutAt) : Date.now();
    const waitMs = earliest + 5_000 - Date.now();
    if (waitMs > 0) {
      if (waitMs > ctx.options.maxWaitMinutes * 60_000) {
        throw new StepNotYet(
          new Date(earliest).toISOString(),
          `the booked ${detail.scheduledHours} h end at ${detail.earliestCheckOutAt}`,
        );
      }
      process.stdout.write(`      waiting ${Math.ceil(waitMs / 60_000)} min for check-out…\n`);
      await sleep(waitMs);
    }
    const r = await ctx.pro.onsite.checkOut(
      assignmentId,
      { ...fix(ctx), declaredFrameCount: FRAME_COUNT },
      { idempotencyKey: newIdempotencyKey() },
    );
    return `booking ${r.bookingStatus}; SLA T0 ${r.slaT0}, delivery due ${r.deliveryDueAt}`;
  },
};

const upload: Step = {
  id: 'upload',
  name: 'portal upload (multipart)',
  async run(ctx) {
    const bookingId = ctx.need('bookingId');
    // An SDK call first: it refreshes an expired access token before the raw upload calls.
    await ctx.pro.uploadJobs();
    const token = ctx.proTokens.getAccessToken();
    if (!token) throw new Error('the photographer is signed out');
    const files = syntheticCard();
    const result = await uploadCard(ctx.options.api, token, bookingId, files);
    ctx.update({
      uploadSessionId: result.sessionId,
      uploaded: Object.fromEntries(files.map((f) => [f.name, f.sha256])),
    });
    return `${result.receivedFileCount} files, ${result.parts} parts, ${result.bytes} bytes; booking ${result.bookingStatus}`;
  },
};

const exportToQa: Step = {
  id: 'export',
  name: 'JPEG export → QA',
  async run(ctx) {
    const status = await waitFor(
      'QA',
      () => bookingStatus(ctx),
      (s) => s === 'QA',
      {
        timeoutMs: 180_000,
        intervalMs: 2_000,
      },
    );
    return `booking ${status}`;
  },
};

const qa: Step = {
  id: 'qa',
  name: 'staff QA pass (admin)',
  async run(ctx) {
    const { staffEmail, staffPassword, staffTotpSecret, api } = ctx.options;
    const admin = await signInStaff(api, staffEmail, staffPassword, staffTotpSecret);
    const view = await admin.qa.decide(
      ctx.need('bookingId'),
      { result: 'PASS', note: 'Dry run: synthetic files' },
      { idempotencyKey: newIdempotencyKey() },
    );
    return `${staffEmail}: booking ${view.bookingStatus}, QA ${view.qaStatus}, balance due ${view.balanceDuePaise} paise`;
  },
};

/** The client's delivery view: what is still due before the links open (Invariant 9). */
async function deliveryView(ctx: RunContext) {
  await ctx.client.bookings.get(ctx.need('bookingId')); // refreshes an expired access token
  return rawCall(ctx.options.api, {
    method: 'GET',
    path: `/bookings/${ctx.need('bookingId')}/delivery`,
    schema: DeliveryView,
    token: ctx.clientTokens.getAccessToken(),
  });
}

const balance: Step = {
  id: 'balance',
  name: 'pay balance (sandbox)',
  async run(ctx) {
    const bookingId = ctx.need('bookingId');
    const before = await deliveryView(ctx);
    if (before.balanceDuePaise > 0) {
      const order = await ctx.client.bookings.pay(bookingId, {
        idempotencyKey: newIdempotencyKey(),
      });
      const sim = await ctx.client.dev.simulatePayment(order.paymentId, 'CAPTURED');
      if (sim.outcome !== 'APPLIED') throw new Error(`the simulated webhook was ${sim.outcome}`);
    }
    // Release is the outbox's work (booking.balance_pending / payment.balance_captured → links).
    const after = await waitFor(
      'DELIVERED',
      () => bookingStatus(ctx),
      (s) => s === 'DELIVERED',
      {
        timeoutMs: 30_000,
      },
    );
    return before.balanceDuePaise > 0
      ? `${before.balanceDuePaise} paise captured; booking ${after}`
      : `nothing due (paid in full upfront); booking ${after}`;
  },
};

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

const deliver: Step = {
  id: 'deliver',
  name: 'delivery link works',
  async run(ctx) {
    const view = await deliveryView(ctx);
    const raw = view.links.find((l) => l.kind === 'RAW_PHOTO' && !l.revoked);
    if (view.bookingStatus !== 'DELIVERED' || !raw) {
      throw new Error(
        `no open RAW link (status ${view.bookingStatus}, ${view.links.length} links)`,
      );
    }
    // The public listing the website's /d/<token> page reads: no auth, no cookies.
    const folder = await rawCall(ctx.options.api, {
      method: 'GET',
      path: raw.path,
      schema: DeliveryFolderView,
    });
    const uploaded = ctx.need('uploaded');
    const file = folder.files.find((f) => uploaded[f.name] !== undefined);
    if (!file)
      throw new Error(`the RAW link lists none of the uploaded files (${folder.fileCount})`);
    const bytes = await rawBytes(ctx.options.api, file.path);
    if (sha256(bytes) !== uploaded[file.name]) throw new Error(`${file.name} came back different`);
    return `${view.links.length} links; ${folder.bookingReference} lists ${folder.fileCount} RAW files; ${file.name} byte-identical`;
  },
};

const review: Step = {
  id: 'review',
  name: 'client reviews',
  async run(ctx) {
    const saved = await ctx.client.reviews.save(ctx.need('bookingId'), {
      rating: 5,
      comment: 'Dry run review (scripts/dry-run).',
    });
    return `${saved.rating}/5 saved (${saved.id.slice(0, 8)})`;
  },
};

export const DELIVERY_STEPS: readonly Step[] = [
  checkOut,
  upload,
  exportToQa,
  qa,
  balance,
  deliver,
  review,
];
