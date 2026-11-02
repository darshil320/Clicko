import { z } from 'zod';
import {
  BookingRef,
  FirstName,
  IstDate,
  IstWhen,
  LinkToken,
  Minutes,
  Rupees,
  TicketRef,
  UtrLast4,
  VirtualNumber,
} from './variables';

export type Channel = 'WHATSAPP' | 'SMS' | 'PUSH';

/**
 * `transactional` always goes, any hour, whatever the mutes (ADR-0027 D2). `utility` is
 * non-essential (reminders): held through quiet hours (21:00–08:00 IST) and muted by opt-outs.
 * Both register with Meta as category UTILITY — nothing here is marketing.
 */
export type TemplateCategory = 'transactional' | 'utility';
export type Audience = 'CLIENT' | 'PRO';

export interface TemplateDef<V extends z.ZodRawShape = z.ZodRawShape> {
  readonly code: string;
  /** Bumped whenever the wording or variables change: a new Meta/DLT approval. */
  readonly version: number;
  readonly language: 'en';
  readonly category: TemplateCategory;
  readonly audience: Audience;
  readonly channels: readonly Channel[];
  /** The name submitted to Meta (WhatsApp Manager); includes the version. */
  readonly whatsappName: string;
  readonly variables: z.ZodObject<V>;
  /** Body parameters {{1}}, {{2}} … in this order — mirrors the approved template. */
  readonly bodyOrder: readonly (keyof V & string)[];
  /** A dynamic URL button: its suffix variable (the base URL is fixed in the approved template). */
  readonly urlButton?: keyof V & string;
  /** Push title (short, no variables). */
  readonly title: string;
  /** The text as approved; `{name}` placeholders. The SMS/DLT template mirrors it. */
  readonly text: string;
  /**
   * The push body when it must differ from `text`: a push shows on the lock screen and passes
   * through Expo, FCM and APNs, so it never carries a delivery link (`{link}`). The app deep-links
   * with the push data (bookingId) instead.
   */
  readonly pushText?: string;
}

/** Any template, whatever its variables — what the pipeline handles generically. */
export type AnyTemplate = Omit<TemplateDef, 'variables' | 'bodyOrder' | 'urlButton'> & {
  readonly variables: z.ZodType<Record<string, string>>;
  readonly bodyOrder: readonly string[];
  readonly urlButton?: string;
};

function template<V extends z.ZodRawShape>(def: Omit<TemplateDef<V>, 'language'>): TemplateDef<V> {
  return { ...def, language: 'en' };
}

const CLIENT_MESSAGING: readonly Channel[] = ['WHATSAPP', 'SMS', 'PUSH'];

/** Every lifecycle template of ADR-0027 D2 whose domain event exists (see event-map.ts). */
export const TEMPLATES = {
  BOOKING_CONFIRMED: template({
    code: 'BOOKING_CONFIRMED',
    version: 1,
    category: 'transactional',
    audience: 'CLIENT',
    channels: CLIENT_MESSAGING,
    whatsappName: 'booking_confirmed_v1',
    variables: z.object({ bookingRef: BookingRef, when: IstWhen }).strict(),
    bodyOrder: ['bookingRef', 'when'],
    title: 'Booking confirmed',
    text: 'Your Clickco booking {bookingRef} for {when} is confirmed. We will share your photographer once one is assigned.',
  }),
  PHOTOGRAPHER_ASSIGNED: template({
    code: 'PHOTOGRAPHER_ASSIGNED',
    version: 1,
    category: 'transactional',
    audience: 'CLIENT',
    channels: CLIENT_MESSAGING,
    whatsappName: 'photographer_assigned_v1',
    variables: z
      .object({
        bookingRef: BookingRef,
        photographerName: FirstName,
        when: IstWhen,
        callNumber: VirtualNumber,
      })
      .strict(),
    bodyOrder: ['photographerName', 'bookingRef', 'when', 'callNumber'],
    title: 'Photographer assigned',
    text: '{photographerName} will shoot your booking {bookingRef} on {when}. Call them from the Clickco app: calls show {callNumber} and your number stays private.',
  }),
  PHOTOGRAPHER_ON_THE_WAY: template({
    code: 'PHOTOGRAPHER_ON_THE_WAY',
    version: 1,
    category: 'transactional',
    audience: 'CLIENT',
    channels: CLIENT_MESSAGING,
    whatsappName: 'photographer_on_the_way_v1',
    variables: z.object({ bookingRef: BookingRef, photographerName: FirstName }).strict(),
    bodyOrder: ['photographerName', 'bookingRef'],
    title: 'On the way',
    text: '{photographerName} is on the way to your Clickco shoot {bookingRef}.',
  }),
  CHECKED_IN: template({
    code: 'CHECKED_IN',
    version: 1,
    category: 'transactional',
    audience: 'CLIENT',
    channels: CLIENT_MESSAGING,
    whatsappName: 'photographer_checked_in_v1',
    variables: z.object({ bookingRef: BookingRef, photographerName: FirstName }).strict(),
    bodyOrder: ['photographerName', 'bookingRef'],
    title: 'Photographer has arrived',
    text: '{photographerName} has arrived for your Clickco shoot {bookingRef}.',
  }),
  EXTENSION_REQUESTED: template({
    code: 'EXTENSION_REQUESTED',
    version: 1,
    category: 'transactional',
    audience: 'CLIENT',
    channels: CLIENT_MESSAGING,
    whatsappName: 'extension_requested_v1',
    variables: z.object({ bookingRef: BookingRef, minutes: Minutes, amount: Rupees }).strict(),
    bodyOrder: ['bookingRef', 'minutes', 'amount'],
    title: 'Extend your shoot?',
    text: 'Your photographer asked to extend shoot {bookingRef} by {minutes} minutes for {amount}. Approve or decline in the Clickco app within 10 minutes.',
  }),
  CHECKED_OUT: template({
    code: 'CHECKED_OUT',
    version: 1,
    category: 'transactional',
    audience: 'CLIENT',
    channels: CLIENT_MESSAGING,
    whatsappName: 'shoot_complete_v1',
    variables: z.object({ bookingRef: BookingRef }).strict(),
    bodyOrder: ['bookingRef'],
    title: 'Shoot complete',
    text: 'Your Clickco shoot {bookingRef} is complete. We will message you as soon as your photos are ready.',
  }),
  BALANCE_DUE: template({
    code: 'BALANCE_DUE',
    version: 1,
    category: 'transactional',
    audience: 'CLIENT',
    channels: CLIENT_MESSAGING,
    whatsappName: 'balance_due_v1',
    variables: z.object({ bookingRef: BookingRef, amount: Rupees }).strict(),
    bodyOrder: ['bookingRef', 'amount'],
    title: 'Your photos are ready',
    text: 'Your photos for {bookingRef} have passed our quality check. Pay the balance of {amount} in the Clickco app to receive them.',
  }),
  BALANCE_REMINDER: template({
    code: 'BALANCE_REMINDER',
    version: 1,
    category: 'utility',
    audience: 'CLIENT',
    channels: CLIENT_MESSAGING,
    whatsappName: 'balance_reminder_v1',
    variables: z.object({ bookingRef: BookingRef, amount: Rupees }).strict(),
    bodyOrder: ['bookingRef', 'amount'],
    title: 'Your photos are waiting',
    text: 'Reminder: your photos for {bookingRef} are waiting. Pay the balance of {amount} in the Clickco app to receive them.',
  }),
  DELIVERED: template({
    code: 'DELIVERED',
    version: 1,
    category: 'transactional',
    audience: 'CLIENT',
    channels: CLIENT_MESSAGING,
    whatsappName: 'photos_delivered_v1',
    variables: z.object({ bookingRef: BookingRef, linkToken: LinkToken }).strict(),
    bodyOrder: ['bookingRef'],
    urlButton: 'linkToken',
    title: 'Your photos are here',
    text: 'Your photos for {bookingRef} are ready: {link}',
    pushText: 'Your photos for {bookingRef} are ready. Open Clickco to see them.',
  }),
  REFUND_ISSUED: template({
    code: 'REFUND_ISSUED',
    version: 1,
    category: 'transactional',
    audience: 'CLIENT',
    channels: CLIENT_MESSAGING,
    whatsappName: 'refund_issued_v1',
    variables: z.object({ bookingRef: BookingRef, amount: Rupees }).strict(),
    bodyOrder: ['amount', 'bookingRef'],
    title: 'Refund processed',
    text: 'A refund of {amount} for booking {bookingRef} has been processed. It can take 5–7 working days to reach your account.',
  }),
  CREDIT_ISSUED: template({
    code: 'CREDIT_ISSUED',
    version: 1,
    category: 'transactional',
    audience: 'CLIENT',
    channels: CLIENT_MESSAGING,
    whatsappName: 'credit_issued_v1',
    variables: z.object({ amount: Rupees, expiresOn: IstDate }).strict(),
    bodyOrder: ['amount', 'expiresOn'],
    title: 'Clickco credit added',
    text: 'You have {amount} of Clickco credit, valid until {expiresOn}. It is applied at your next booking.',
  }),
  TICKET_RECEIVED: template({
    code: 'TICKET_RECEIVED',
    version: 1,
    category: 'transactional',
    audience: 'CLIENT',
    channels: CLIENT_MESSAGING,
    whatsappName: 'ticket_received_v1',
    variables: z.object({ ticketRef: TicketRef, replyBy: IstWhen }).strict(),
    bodyOrder: ['ticketRef', 'replyBy'],
    title: 'Request received',
    text: 'We have received your Clickco support request {ticketRef}. Our team will reply by {replyBy}. You can follow it in the Clickco app.',
  }),
  PRO_NEW_OFFER: template({
    code: 'PRO_NEW_OFFER',
    version: 1,
    category: 'transactional',
    audience: 'PRO',
    channels: ['PUSH'],
    whatsappName: 'pro_new_offer_v1',
    variables: z.object({ when: IstWhen, amount: Rupees }).strict(),
    bodyOrder: ['when', 'amount'],
    title: 'New job offer',
    text: 'New job on {when}, earn {amount}. Open Clickco Pro to accept before it expires.',
  }),
  PRO_PAYOUT_PAID: template({
    code: 'PRO_PAYOUT_PAID',
    version: 1,
    category: 'transactional',
    audience: 'PRO',
    channels: CLIENT_MESSAGING,
    whatsappName: 'pro_payout_paid_v1',
    variables: z.object({ amount: Rupees, utrLast4: UtrLast4 }).strict(),
    bodyOrder: ['amount', 'utrLast4'],
    title: 'Payout sent',
    text: 'Clickco has paid you {amount} (bank reference ending {utrLast4}). See Earnings in Clickco Pro for details.',
  }),
  PRO_PAYOUT_ON_HOLD: template({
    code: 'PRO_PAYOUT_ON_HOLD',
    version: 1,
    category: 'transactional',
    audience: 'PRO',
    channels: CLIENT_MESSAGING,
    whatsappName: 'pro_payout_on_hold_v1',
    variables: z.object({ amount: Rupees, shootDate: IstDate }).strict(),
    bodyOrder: ['amount', 'shootDate'],
    title: 'Payout on hold',
    text: 'Your Clickco payout of {amount} for the shoot on {shootDate} is on hold while our team reviews it. We will message you when it is released.',
  }),
  PRO_PAYOUT_RELEASED: template({
    code: 'PRO_PAYOUT_RELEASED',
    version: 1,
    category: 'transactional',
    audience: 'PRO',
    channels: CLIENT_MESSAGING,
    whatsappName: 'pro_payout_released_v1',
    variables: z.object({ amount: Rupees, shootDate: IstDate }).strict(),
    bodyOrder: ['amount', 'shootDate'],
    title: 'Payout released',
    text: 'Your Clickco payout of {amount} for the shoot on {shootDate} has been released. It will be paid in an upcoming weekly payout.',
  }),
} as const satisfies Record<string, AnyTemplate>;

export type TemplateCode = keyof typeof TEMPLATES;
export const TEMPLATE_CODES = Object.keys(TEMPLATES) as TemplateCode[];

export function templateOf(code: string): AnyTemplate | null {
  return Object.hasOwn(TEMPLATES, code) ? (TEMPLATES[code as TemplateCode] as AnyTemplate) : null;
}

export class TemplateVariablesError extends Error {
  constructor(
    readonly code: string,
    readonly fields: readonly string[],
  ) {
    super(`Template ${code}: invalid variables (${fields.join(', ')})`);
    this.name = 'TemplateVariablesError';
  }
}

/** Validated variables as strings. Throws TemplateVariablesError (field names only, no values). */
export function validateVariables(
  def: AnyTemplate,
  vars: unknown,
): Readonly<Record<string, string>> {
  const parsed = def.variables.safeParse(vars);
  if (!parsed.success) {
    throw new TemplateVariablesError(
      def.code,
      parsed.error.issues.map((i) => i.path.join('.') || '(root)'),
    );
  }
  return parsed.data as Record<string, string>;
}

const PLACEHOLDER = /\{(\w+)\}/g;

/**
 * The value of every `{name}` in the template text: the variable itself, or for `{link}` the full
 * delivery link. What the SMS provider fills into the DLT template (##name## there).
 */
export function placeholderValues(
  def: AnyTemplate,
  vars: Readonly<Record<string, string>>,
  linkBase: string,
): Readonly<Record<string, string>> {
  const names = [...def.text.matchAll(PLACEHOLDER)].map((m) => m[1] as string);
  return Object.fromEntries(
    names.map((name) => [
      name,
      name === 'link' ? `${linkBase}/d/${vars.linkToken ?? ''}` : (vars[name] ?? ''),
    ]),
  );
}

/** The push body: `pushText` (never a link) or the text, with its variables filled in. */
export function renderPushText(def: AnyTemplate, vars: Readonly<Record<string, string>>): string {
  const body = def.pushText ?? def.text;
  if (body.includes('{link}')) throw new Error(`Template ${def.code}: a push never carries a link`);
  return body.replace(PLACEHOLDER, (_, name: string) => vars[name] ?? '');
}

/** The message text with its variables filled in (console, WhatsApp/SMS preview). */
export function renderText(
  def: AnyTemplate,
  vars: Readonly<Record<string, string>>,
  linkBase: string,
): string {
  const values = placeholderValues(def, vars, linkBase);
  return def.text.replace(PLACEHOLDER, (_, name: string) => values[name] ?? '');
}
