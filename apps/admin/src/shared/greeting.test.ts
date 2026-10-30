import { describe, expect, it } from 'vitest';
import { firstName, greeting, greetingFor, istHour } from './greeting';

const at = (iso: string) => Date.parse(iso);

describe('the Today greeting (ADR-0026 D8)', () => {
  it('reads the hour in IST', () => {
    // 9:30 am UTC = 3:00 pm IST; 7:00 pm UTC = 12:30 am IST.
    expect(istHour(at('2026-10-30T09:30:00Z'))).toBe(15);
    expect(istHour(at('2026-10-30T19:00:00Z'))).toBe(0);
  });

  it.each([
    ['2026-10-29T22:30:00Z', 'Good morning'], // 4:00 am IST
    ['2026-10-30T06:29:00Z', 'Good morning'], // 11:59 am
    ['2026-10-30T06:30:00Z', 'Good afternoon'], // noon
    ['2026-10-30T11:29:00Z', 'Good afternoon'], // 4:59 pm
    ['2026-10-30T11:30:00Z', 'Good evening'], // 5:00 pm
    ['2026-10-30T20:00:00Z', 'Good evening'], // 1:30 am
  ])('%s is "%s"', (iso, text) => {
    expect(greetingFor(at(iso))).toBe(text);
  });

  it('greets by first name', () => {
    expect(firstName('  Aisha   Khan ')).toBe('Aisha');
    expect(firstName('   ')).toBeNull();
    expect(greeting(at('2026-10-30T09:30:00Z'), 'Aisha Khan')).toBe('Good afternoon, Aisha');
    expect(greeting(at('2026-10-30T09:30:00Z'), '')).toBe('Good afternoon');
  });
});
