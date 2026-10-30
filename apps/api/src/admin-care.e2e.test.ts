import type { BookingStatus, StaffRole } from '@clickco/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BookingsService } from './modules/bookings/bookings.service';
import { walkTo } from './modules/media/__tests__/media-fixtures';
import { bookingStatus } from './test-support/dispatch-fixtures';
import { type E2eApp, type Json, startE2eApp } from './test-support/e2e-app';
import { acceptOffer, bookAndPay, insertClient } from './test-support/onsite-fixtures';
import { insertPhotographer } from './test-support/photographer-fixtures';
import { TEST_DATABASE_URL } from './test-support/scratch-db';
import { bootstrapStaff, cityIdOf, staffToken } from './test-support/staff-fixtures';

const NOW = new Date('2026-12-07T04:30:00.000Z');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
let keySeq = 0;
const idem = () => `admin-care-${String(++keySeq).padStart(6, '0')}`;

/** After check-out, the rest of the way to DELIVERED through the state machine (no media). */
const TO_DELIVERED: readonly BookingStatus[] = [
  'UPLOADING',
  'PROCESSING',
  'QA',
  'BALANCE_PENDING',
  'DELIVERED',
];

/**
 * ADR-0026 D6 end to end: a quality issue opened on a delivered booking and decided by the QM
 * (QUALITY_ESCALATION → CLOSED, a review item for "To settle"); a grievance ticket with its 48 h /
 * 30-day clocks, an append-only thread, acknowledgement and resolution; an equipment claim
 * assessed and approved within the cap (a finance review item). Roles, cities and audit rows.
 */
describe.runIf(TEST_DATABASE_URL)('the customer care desks', () => {
  let e2e: E2eApp;
  const staff = {} as Record<
    'admin' | 'cmSurat' | 'cmMumbai' | 'ops' | 'qm' | 'support' | 'finance' | 'readOnly',
    string
  >;
  let delivered: { id: string; reference: string };
  let shot: { id: string; reference: string };

  const as = (who: keyof typeof staff) => staffToken(e2e, staff[who]);
  const get = async (who: keyof typeof staff, path: string) =>
    e2e.call('GET', path, { token: await as(who) });
  const post = async (who: keyof typeof staff, path: string, body?: unknown) =>
    e2e.call('POST', path, {
      token: await as(who),
      idempotencyKey: idem(),
      ...(body === undefined ? {} : { body }),
    });
  const auditRows = (action: string) =>
    e2e.db.sql<{ actor_id: string; entity_id: string; after_state: Json }[]>`
      SELECT actor_id, entity_id, after_state FROM audit_logs WHERE action = ${action} ORDER BY id`;
  const reviews = (bookingId: string) =>
    e2e.db.sql<{ payload: Json }[]>`
      SELECT payload FROM domain_events
      WHERE aggregate_id = ${bookingId} AND event_type = 'booking.needs_review' ORDER BY id`;
  const referenceOf = async (id: string) =>
    (await e2e.db.sql<{ reference: string }[]>`SELECT reference FROM bookings WHERE id = ${id}`)[0]
      ?.reference ?? '';

  beforeAll(async () => {
    e2e = await startE2eApp({ now: NOW, nodeEnv: 'development' });
    const surat = await cityIdOf(e2e, 'Surat');
    const mumbai = await cityIdOf(e2e, 'Mumbai');
    const make = async (key: keyof typeof staff, role: StaffRole, cityId: string | null = null) => {
      staff[key] = (await bootstrapStaff(e2e, `${key}@clickco.test`, role, cityId)).id;
    };
    await make('admin', 'SUPER_ADMIN');
    await make('cmSurat', 'CITY_MANAGER', surat);
    await make('cmMumbai', 'CITY_MANAGER', mumbai);
    await make('ops', 'OPS_AGENT');
    await make('qm', 'QUALITY_MANAGER');
    await make('support', 'SUPPORT');
    await make('finance', 'FINANCE');
    await make('readOnly', 'READ_ONLY');

    const pro = await insertPhotographer(e2e.db.sql, {
      phone: '+919825089001',
      km: 3,
      categories: [{ code: 'FOOD', tier: 'EXPERT' }],
    });
    const walk = async (phone: string, startInDays: number) => {
      const start = new Date(e2e.now().getTime() + startInDays * DAY);
      const booking = await bookAndPay(e2e, await insertClient(e2e, phone), start);
      const assignmentId = await acceptOffer(e2e, pro, booking.id as string);
      await walkTo(e2e, booking.id as string, assignmentId, 'CHECKED_OUT', 1);
      return booking.id as string;
    };
    const deliveredId = await walk('+919700089001', 6);
    const bookings = e2e.get(BookingsService);
    for (const to of TO_DELIVERED) {
      const now = e2e.now();
      await e2e.db.sql.begin(async (tx) => {
        await bookings.transition(tx, {
          bookingId: deliveredId,
          to,
          actor: { kind: 'SYSTEM', id: null },
          occurredAt: now,
          reason: 'care test fixture',
        });
        if (to === 'DELIVERED') await bookings.recordDelivered(tx, deliveredId, now);
      });
    }
    const shotId = await walk('+919700089002', 10);
    delivered = { id: deliveredId, reference: await referenceOf(deliveredId) };
    shot = { id: shotId, reference: await referenceOf(shotId) };
  }, 240_000);

  afterAll(async () => {
    await e2e?.close();
  });

  describe('quality issues (QM queue)', () => {
    let issueId: string;

    it('opens only on a delivered booking', async () => {
      const early = await post('support', '/admin/care/quality', {
        bookingReference: shot.reference,
        complaint: 'Photos are blurry in the first set',
      });
      expect(early.status).toBe(409);
      expect(early.json.error.code).toBe('BOOKING_NOT_DELIVERED');
      const unknown = await post('support', '/admin/care/quality', {
        bookingReference: 'CLK-999999',
        complaint: 'Photos are blurry in the first set',
      });
      expect(unknown.status).toBe(404);
      const otherCity = await post('cmMumbai', '/admin/care/quality', {
        bookingReference: delivered.reference,
        complaint: 'Photos are blurry in the first set',
      });
      expect(otherCity.status).toBe(404);
    });

    it('support logs the complaint: DELIVERED → QUALITY_ESCALATION, with its event', async () => {
      const res = await post('support', '/admin/care/quality', {
        bookingReference: delivered.reference.toLowerCase(),
        complaint: 'Half the food shots are out of focus',
      });
      expect(res.status).toBe(201);
      expect(res.json.data).toMatchObject({
        status: 'OPEN',
        reference: delivered.reference,
        raisedByKind: 'STAFF',
        raisedByName: 'Test SUPPORT',
        outcome: null,
      });
      issueId = res.json.data.id;
      expect(await bookingStatus(e2e, delivered.id)).toBe('QUALITY_ESCALATION');
      const [event] = await e2e.db.sql<{ payload: Json }[]>`
        SELECT payload FROM domain_events
        WHERE aggregate_id = ${delivered.id} AND event_type = 'booking.quality_escalation'`;
      expect(event?.payload).toMatchObject({ escalation_id: issueId, actor_kind: 'STAFF' });
      const again = await post('support', '/admin/care/quality', {
        bookingReference: delivered.reference,
        complaint: 'Half the food shots are out of focus',
      });
      expect(again.status).toBe(409);
    });

    it('lists it for the QM; another city sees nothing; finance cannot open the desk', async () => {
      const mine = await get('qm', '/admin/care/quality');
      expect((mine.json.data.items as Json[]).map((i) => i.id)).toEqual([issueId]);
      expect((await get('cmMumbai', '/admin/care/quality')).json.data.items).toEqual([]);
      expect((await get('finance', '/admin/care/quality')).status).toBe(403);
    });

    it('only the QM picks it up and decides it', async () => {
      expect((await post('support', `/admin/care/quality/${issueId}/take`)).status).toBe(403);
      const taken = await post('qm', `/admin/care/quality/${issueId}/take`);
      expect(taken.json.data).toMatchObject({
        status: 'IN_REVIEW',
        assignedQmName: 'Test QUALITY_MANAGER',
      });
      const tooMuch = await post('qm', `/admin/care/quality/${issueId}/resolve`, {
        outcome: 'CREDIT',
        amountPaise: 100_000_000,
        note: 'Full credit',
      });
      expect(tooMuch.json.error.code).toBe('CREDIT_ABOVE_TOTAL');
      const noAmount = await post('qm', `/admin/care/quality/${issueId}/resolve`, {
        outcome: 'PARTIAL_REFUND',
        note: 'Refund part',
      });
      expect(noAmount.status).toBe(400);
    });

    it('a credit closes the issue and the booking and raises QUALITY_CREDIT_DUE', async () => {
      const res = await post('qm', `/admin/care/quality/${issueId}/resolve`, {
        outcome: 'CREDIT',
        amountPaise: 250_000,
        note: 'Agreed a ₹2,500 credit with the client',
      });
      expect(res.status).toBe(200);
      expect(res.json.data).toMatchObject({
        status: 'RESOLVED',
        outcome: 'CREDIT',
        remedyPaise: 250_000,
      });
      expect(await bookingStatus(e2e, delivered.id)).toBe('CLOSED');
      const [closed] = await e2e.db.sql<{ closed_at: Date | null }[]>`
        SELECT closed_at FROM bookings WHERE id = ${delivered.id}`;
      expect(closed?.closed_at).not.toBeNull();
      const items = await reviews(delivered.id);
      expect(items.map((r) => r.payload.reason)).toEqual(['QUALITY_CREDIT_DUE']);
      expect(items[0]?.payload).toMatchObject({ escalation_id: issueId, amount_paise: 250_000 });
      expect((await auditRows('quality.resolve')).at(-1)).toMatchObject({
        actor_id: staff.qm,
        entity_id: issueId,
      });
      const again = await post('qm', `/admin/care/quality/${issueId}/resolve`, {
        outcome: 'NO_ACTION',
        note: 'Second decision',
      });
      expect(again.json.error.code).toBe('QUALITY_ISSUE_DECIDED');
      const resolved = await get('qm', '/admin/care/quality?status=RESOLVED');
      expect((resolved.json.data.items as Json[]).map((i) => i.id)).toEqual([issueId]);
    });
  });

  describe('support tickets (SA-02)', () => {
    let ticketId: string;
    let receivedAt: number;

    it('logs a grievance with its 48-hour and 30-day clocks; the first message is the customer’s', async () => {
      receivedAt = e2e.now().getTime();
      const res = await post('support', '/admin/care/tickets', {
        raisedBy: 'USER',
        contactName: 'Priya Sharma',
        contactPhone: '+919700089002',
        bookingReference: shot.reference,
        category: 'GRIEVANCE',
        subject: 'Photographer arrived late',
        message: 'The photographer came 40 minutes late and rushed the shoot.',
      });
      expect(res.status).toBe(201);
      ticketId = res.json.data.id;
      expect(res.json.data).toMatchObject({
        status: 'OPEN',
        isGrievance: true,
        bookingReference: shot.reference,
        acknowledgedAt: null,
      });
      expect(res.json.data.reference).toMatch(/^TKT-\d+$/);
      expect(Date.parse(res.json.data.ackDueAt)).toBe(receivedAt + 48 * HOUR);
      expect(Date.parse(res.json.data.resolveDueAt)).toBe(receivedAt + 30 * DAY);
      expect(res.json.data.messages).toMatchObject([
        { authorKind: 'CUSTOMER', authorName: 'Priya Sharma', isInternal: false },
      ]);
    });

    it('refuses a ticket nobody can be reached on, or one outside the caller’s cities', async () => {
      const base = {
        raisedBy: 'PUBLIC',
        contactName: 'Someone',
        category: 'OTHER',
        subject: 'Question',
        message: 'Hello there',
      };
      expect((await post('support', '/admin/care/tickets', base)).status).toBe(400);
      const cityless = await post('cmMumbai', '/admin/care/tickets', {
        ...base,
        contactEmail: 'someone@example.com',
      });
      expect(cityless.json.error.code).toBe('TICKET_NEEDS_A_CITY');
      // A Surat photographer's phone does not place a Mumbai manager's ticket in Surat.
      const probe = await post('cmMumbai', '/admin/care/tickets', {
        ...base,
        raisedBy: 'PHOTOGRAPHER',
        contactPhone: '+919825089001',
      });
      expect(probe.json.error.code).toBe('TICKET_NEEDS_A_CITY');
      expect((await get('cmMumbai', `/admin/care/tickets/${ticketId}`)).status).toBe(404);
      expect((await get('readOnly', '/admin/care/tickets')).status).toBe(403);
    });

    it('goes overdue past 48 hours without an acknowledgement', async () => {
      expect(
        ((await get('ops', '/admin/care/tickets?view=OVERDUE')).json.data.items as Json[]).length,
      ).toBe(0);
      e2e.advance(49 * HOUR);
      const overdue = await get('ops', '/admin/care/tickets?view=OVERDUE');
      expect((overdue.json.data.items as Json[]).map((t) => t.id)).toEqual([ticketId]);
    });

    it('a reply acknowledges and waits on the customer; a note stays internal', async () => {
      const path = `/admin/care/tickets/${ticketId}/messages`;
      const reply = await post('support', path, {
        kind: 'REPLY',
        body: 'Sorry about this, Priya. We are looking into it today.',
      });
      expect(reply.status).toBe(200);
      expect(reply.json.data.status).toBe('AWAITING_CUSTOMER');
      expect(reply.json.data.acknowledgedAt).not.toBeNull();
      e2e.advance(60_000);
      const note = await post('support', path, { kind: 'NOTE', body: 'Called the photographer' });
      expect(note.json.data.messages.map((m: Json) => [m.authorKind, m.isInternal])).toEqual([
        ['CUSTOMER', false],
        ['STAFF', false],
        ['STAFF', true],
      ]);
      expect(note.json.data.messages[1].authorName).toBe('Test SUPPORT');
      const ack = await post('support', `/admin/care/tickets/${ticketId}/acknowledge`);
      expect(ack.json.error.code).toBe('TICKET_ALREADY_ACKNOWLEDGED');
    });

    it('the thread is append-only in the database', async () => {
      await expect(
        e2e.db.sql`UPDATE ticket_messages SET body = 'edited' WHERE ticket_id = ${ticketId}`,
      ).rejects.toThrow(/append-only/);
    });

    it('assigns to me, then resolves with a summary; nothing is added after', async () => {
      const assigned = await post('cmSurat', `/admin/care/tickets/${ticketId}/assign-to-me`);
      expect(assigned.json.data.assignedToName).toBe('Test CITY_MANAGER');
      const mine = await get('cmSurat', '/admin/care/tickets?view=MINE');
      expect((mine.json.data.items as Json[]).map((t) => t.id)).toEqual([ticketId]);
      const resolved = await post('cmSurat', `/admin/care/tickets/${ticketId}/resolve`, {
        summary: 'Apologised; ₹500 goodwill credit sent to To settle.',
      });
      expect(resolved.json.data).toMatchObject({
        status: 'RESOLVED',
        resolutionSummary: 'Apologised; ₹500 goodwill credit sent to To settle.',
      });
      const late = await post('support', `/admin/care/tickets/${ticketId}/messages`, {
        kind: 'NOTE',
        body: 'one more',
      });
      expect(late.json.error.code).toBe('TICKET_RESOLVED');
      const done = await get('support', '/admin/care/tickets?view=RESOLVED');
      expect((done.json.data.items as Json[]).map((t) => t.id)).toEqual([ticketId]);
      expect((await auditRows('ticket.resolve')).length).toBe(1);
    });
  });

  describe('equipment claims (SA-01)', () => {
    let claimId: string;

    it('logs a claim against the booking’s photographer', async () => {
      expect((await get('support', '/admin/care/claims')).status).toBe(403);
      const res = await post('cmSurat', '/admin/care/claims', {
        bookingReference: shot.reference,
        incidentAt: new Date(e2e.now().getTime() - HOUR).toISOString(),
        cause: 'GUEST',
        description: 'A guest knocked the lens off the tripod; front element cracked.',
        claimedAmountPaise: 4_500_000,
      });
      expect(res.status).toBe(201);
      expect(res.json.data).toMatchObject({
        status: 'OPEN',
        capPaise: 20_000_000,
        claimedAmountPaise: 4_500_000,
        evidence: [],
      });
      claimId = res.json.data.id;
    });

    it('cannot approve without documentary evidence', async () => {
      const res = await post('finance', `/admin/care/claims/${claimId}/approve`, {
        amountPaise: 4_000_000,
        note: 'Repair quote',
      });
      expect(res.json.error.code).toBe('NO_EVIDENCE');
    });

    it('an assessment adds notes and https links and moves it under review', async () => {
      const res = await post('qm', `/admin/care/claims/${claimId}/assess`, {
        note: 'Spoke to the venue manager; confirmed.',
        links: [{ url: 'https://drive.example/repair-quote.pdf', label: 'Repair quote' }],
      });
      expect(res.json.data.status).toBe('UNDER_REVIEW');
      expect(res.json.data.evidence.map((e: Json) => e.kind)).toEqual(['NOTE', 'LINK']);
      expect(res.json.data.evidence[1].addedByName).toBe('Test QUALITY_MANAGER');
    });

    it('whoever logged the claim does not approve it (four eyes)', async () => {
      const own = await post('cmSurat', `/admin/care/claims/${claimId}/approve`, {
        amountPaise: 4_000_000,
        note: 'Repair quote',
      });
      expect(own.status).toBe(403);
      expect(own.json.error.code).toBe('SAME_PERSON');
    });

    it('approves within the cap and the claim, raising a finance review item', async () => {
      const over = await post('finance', `/admin/care/claims/${claimId}/approve`, {
        amountPaise: 4_500_001,
        note: 'Repair quote',
      });
      expect(over.json.error.code).toBe('ABOVE_CLAIMED');
      const res = await post('finance', `/admin/care/claims/${claimId}/approve`, {
        amountPaise: 4_000_000,
        note: 'Repair quote verified; pay the photographer, recover from the client',
      });
      expect(res.status).toBe(200);
      expect(res.json.data).toMatchObject({
        status: 'APPROVED',
        approvedAmountPaise: 4_000_000,
        reviewedByName: 'Test FINANCE',
      });
      const items = await reviews(shot.id);
      expect(items.map((r) => r.payload.reason)).toEqual(['EQUIPMENT_CLAIM_APPROVED']);
      expect(items[0]?.payload).toMatchObject({ claim_id: claimId, amount_paise: 4_000_000 });
      const again = await post('finance', `/admin/care/claims/${claimId}/reject`, {
        reason: 'Changed mind',
      });
      expect(again.json.error.code).toBe('CLAIM_DECIDED');
      const decided = await get('cmSurat', '/admin/care/claims?status=DECIDED');
      expect((decided.json.data.items as Json[]).map((c) => c.id)).toEqual([claimId]);
      expect((await get('cmMumbai', '/admin/care/claims?status=ALL')).json.data.items).toEqual([]);
    });
  });
});
