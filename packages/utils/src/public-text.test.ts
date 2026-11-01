import { describe, expect, it } from 'vitest';
import { sanitisePublicText } from './public-text.js';

const clean = (text: string, max = 1_000) => sanitisePublicText(text, max);

describe('sanitisePublicText (ADR-0027 D4)', () => {
  it('leaves ordinary review text alone', () => {
    for (const text of [
      'Arrived 10 min early, shot 2 hours, 350 photos. 5/5 would book again!',
      'Paid ₹1,00,000 on 12/10/2026 at 10.30 am — worth it',
      'Mr.Sharma was great, e.g. the candid shots. Great work. In short: yes',
      'Shot on 12.10.2026, order 4471 2093',
      'the shoot was great. com-pletely happy',
      'Loved it. To be honest the edits were quick. Me and my family loved it.',
      'Rated 5/5, 10/10, 100%, would book again in 2027',
      'Shoot on 12/10/2026 10:30 am, 2 hours, 350 photos',
      'A tiny dust dot in two photos, otherwise perfect',
      'Card ending 4471 2093 7788 9900 was charged twice',
      '5+ years of experience, a C++ fan (and +2 bonus edits)',
    ]) {
      expect(clean(text), text).toBe(text);
    }
  });

  it('strips links with and without a scheme, in any case', () => {
    expect(clean('See https://example.com/portfolio?x=1 for more')).toBe('See for more');
    expect(clean('my site www.ravi-photos.in has it')).toBe('my site has it');
    expect(clean('DM on instagram.com/ravi.clicks or wa.me/919876543210')).toBe('DM on or');
    expect(clean('book me at ravi.photography.co.in directly')).toBe('book me at directly');
    expect(clean('HTTP://SHOUTY.COM/X ok')).toBe('ok');
    expect(clean('visit RAVI.COM today')).toBe('visit today');
    expect(clean('visit Ravi.In today')).toBe('visit today');
  });

  it('strips links written to dodge the filter', () => {
    for (const link of [
      'ravi . com',
      'ravi .com',
      'ravi dot com',
      'ravi DOT com',
      'ravi(dot)in',
      'ravi (dot) in',
      'ravi[.]in',
      'ravi [.] in',
      'ravi(.)com',
      'w w w.ravi.in',
      'W W W . ravi . in',
      'ravi．com',
      'ravi。in',
    ]) {
      expect(clean(`see ${link} now`), link).toBe('see now');
    }
  });

  it('strips email addresses, spaced or not', () => {
    expect(clean('Mail ravi.clicks+work@gmail.com today')).toBe('Mail today');
    expect(clean('Mail ravi @ gmail.com today')).toBe('Mail today');
    expect(clean('Mail RAVI@GMAIL.COM today')).toBe('Mail today');
  });

  it('strips phone numbers, however they are written', () => {
    for (const phone of [
      '9876543210',
      '+91 98765 43210',
      '+91-98765-43210',
      '098765 43210',
      '(022) 2345 6789',
      '98 76 54 32 10',
      '9.8.7.6.5.4.3.2.1.0',
      '98765    43210',
      '98765/43210',
      '98765,43210',
      '98765_43210',
      '98765\n43210',
      '98765​43210',
      '9‍8‍7‍6‍5 4‌3‌2‌1‌0',
      '+1 415 555 0100',
      '98765432109876',
    ]) {
      expect(clean(`Call ${phone} now`), JSON.stringify(phone)).toBe('Call now');
    }
  });

  it('reads digits from any script and full-width forms', () => {
    for (const phone of [
      '૯૮૭૬૫ ૪૩૨૧૦', // Gujarati
      '९८७६५ ४३२१०', // Devanagari
      '９８７６５４３２１０', // full-width
      '+９１ ९८७६५-43210', // mixed
    ]) {
      expect(clean(`Call ${phone} now`), phone).toBe('Call now');
    }
  });

  it('strips again what a removal brings together', () => {
    expect(clean('98765 https://x.example.com 43210 ok')).toBe('ok');
    expect(clean('98765 ravi.com 43210 ok')).toBe('ok');
  });

  it('keeps short numbers (prices, counts, years, times)', () => {
    expect(clean('Rated 4 of 5, paid 25000 in 2026, 120 edits')).toBe(
      'Rated 4 of 5, paid 25000 in 2026, 120 edits',
    );
  });

  it('collapses the whitespace a removal leaves and keeps paragraph breaks', () => {
    expect(clean('Great work.\r\n\r\n\r\nCall 9876543210  \n  anytime')).toBe(
      'Great work.\n\nCall\nanytime',
    );
  });

  it('removes control and invisible format characters', () => {
    expect(clean('Nice\u0000 shoot\u0007')).toBe('Nice shoot');
    expect(clean('Ni​ce­ sho⁠ot﻿')).toBe('Nice shoot');
  });

  it('caps the length without splitting a character', () => {
    expect(clean('abcdef', 4)).toBe('abcd');
    expect(clean('ab😀😀', 3)).toBe('ab😀');
  });

  it('returns an empty string when nothing public is left', () => {
    expect(clean('   https://spam.example.com  9876543210 ')).toBe('');
  });
});
