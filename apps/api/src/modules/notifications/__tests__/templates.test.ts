import { describe, expect, it } from 'vitest';
import {
  placeholderValues,
  renderPushText,
  renderText,
  TEMPLATE_CODES,
  TEMPLATES,
  TemplateVariablesError,
  templateOf,
  validateVariables,
} from '../templates/templates';
import {
  firstNameOf,
  formatIstDate,
  formatIstWhen,
  formatRupees,
  Rupees,
  TicketRef,
  utrLast4,
} from '../templates/variables';

const TOKEN = 'A'.repeat(43);

describe('template catalogue (ADR-0027 D2)', () => {
  it.each(TEMPLATE_CODES)('%s is consistent with what goes to Meta and DLT', (code) => {
    const def = TEMPLATES[code];
    expect(def.code).toBe(code);
    expect(def.whatsappName).toMatch(new RegExp(`_v${def.version}$`));
    const keys = Object.keys(def.variables.shape);
    for (const name of def.bodyOrder) expect(keys).toContain(name);
    if ('urlButton' in def && def.urlButton) expect(keys).toContain(def.urlButton);
    // Every {placeholder} in the text is a variable (or the link built from linkToken).
    for (const [, name] of def.text.matchAll(/\{(\w+)\}/g)) {
      expect(name === 'link' ? keys.includes('linkToken') : keys.includes(name as string)).toBe(
        true,
      );
    }
    expect(def.channels.length).toBeGreaterThan(0);
  });

  it('templateOf knows only catalogue codes', () => {
    expect(templateOf('BOOKING_CONFIRMED')?.code).toBe('BOOKING_CONFIRMED');
    expect(templateOf('toString')).toBeNull();
    expect(templateOf('NOPE')).toBeNull();
  });

  it('variables are validated strictly and errors name fields, never values', () => {
    const def = templateOf('BOOKING_CONFIRMED');
    if (!def) throw new Error('missing');
    expect(validateVariables(def, { bookingRef: 'CLK-1001', when: 'Sat 14 Nov, 4:30 pm' })).toEqual(
      { bookingRef: 'CLK-1001', when: 'Sat 14 Nov, 4:30 pm' },
    );
    const bad = () => validateVariables(def, { bookingRef: 'call +919812345678', when: null });
    expect(bad).toThrow(TemplateVariablesError);
    expect(bad).toThrow(/bookingRef, when/);
    expect(bad).not.toThrow(/9812345678/);
    // .strict(): no extra free text can ride along.
    expect(() =>
      validateVariables(def, { bookingRef: 'CLK-1001', when: 'Sat 14 Nov, 4:30 pm', note: 'x' }),
    ).toThrow(TemplateVariablesError);
  });

  it('a push body never carries a delivery link (lock screens, push relays)', () => {
    for (const code of TEMPLATE_CODES) {
      const def = templateOf(code);
      if (!def) throw new Error('missing');
      expect(def.pushText ?? def.text, code).not.toContain('{link}');
    }
    const def = templateOf('DELIVERED');
    if (!def) throw new Error('missing');
    const body = renderPushText(def, { bookingRef: 'CLK-1001', linkToken: TOKEN });
    expect(body).toBe('Your photos for CLK-1001 are ready. Open Clickco to see them.');
    expect(() =>
      renderPushText({ ...def, pushText: undefined }, { bookingRef: 'CLK-1001' }),
    ).toThrow(/never carries a link/);
  });

  it('renders the text and the DLT placeholders, the link to the web delivery page (D6c)', () => {
    const def = templateOf('DELIVERED');
    if (!def) throw new Error('missing');
    const vars = { bookingRef: 'CLK-1001', linkToken: TOKEN };
    expect(renderText(def, vars, 'https://clickco.in')).toBe(
      `Your photos for CLK-1001 are ready: https://clickco.in/d/${TOKEN}`,
    );
    expect(placeholderValues(def, vars, 'https://clickco.in')).toEqual({
      bookingRef: 'CLK-1001',
      link: `https://clickco.in/d/${TOKEN}`,
    });
  });
});

describe('template variables', () => {
  it('formats IST wall-clock times', () => {
    // 11:00 UTC = 16:30 IST, a Saturday.
    expect(formatIstWhen(new Date('2026-11-14T11:00:00Z'))).toBe('Sat 14 Nov, 4:30 pm');
    expect(formatIstWhen(new Date('2026-11-14T18:35:00Z'))).toBe('Sun 15 Nov, 12:05 am');
    expect(formatIstWhen(new Date('2026-11-15T06:30:00Z'))).toBe('Sun 15 Nov, 12:00 pm');
    expect(formatIstDate(new Date('2026-12-31T19:00:00Z'))).toBe('1 Jan 2027');
  });

  it('formats rupees from paise in the Rupees pattern', () => {
    expect(formatRupees(50_000)).toBe('₹500');
    expect(formatRupees(576_725)).toBe('₹5,767.25');
    expect(formatRupees(12_000_000_00)).toBe('₹1,20,00,000');
    for (const p of [0, 100, 576_725, 12_000_000_00]) {
      expect(Rupees.safeParse(formatRupees(p)).success).toBe(true);
    }
  });

  it('takes a vetted first name only', () => {
    expect(firstNameOf('  Priya   Shah ')).toBe('Priya');
    expect(firstNameOf("D'Souza")).toBe("D'Souza");
    expect(firstNameOf('98123 Shah')).toBeNull();
    expect(firstNameOf('Priya<script>')).toBeNull();
    expect(firstNameOf('')).toBeNull();
  });

  it('takes a support ticket reference only', () => {
    expect(TicketRef.safeParse('TKT-1043').success).toBe(true);
    for (const bad of ['TKT-12', 'CLK-1043', 'TKT-1043 call me', 'tkt-1043']) {
      expect(TicketRef.safeParse(bad).success, bad).toBe(false);
    }
  });

  it('keeps the last four characters of a UTR', () => {
    expect(utrLast4('hdfc-r5 2026 11 14 ab12')).toBe('AB12');
    expect(utrLast4('12')).toBeNull();
    expect(utrLast4(null)).toBeNull();
  });
});
