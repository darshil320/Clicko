import { describe, expect, it } from 'vitest';
import { canAct } from './use-can';

describe('canAct', () => {
  const surat = 'surat-id';
  it('lets SUPER_ADMIN do anything anywhere', () => {
    expect(canAct([{ role: 'SUPER_ADMIN', cityId: null }], ['CITY_MANAGER'], surat)).toBe(true);
  });

  it('needs one of the roles, in the city when one is given', () => {
    const cm = [{ role: 'CITY_MANAGER' as const, cityId: surat }];
    expect(canAct(cm, ['CITY_MANAGER'], surat)).toBe(true);
    expect(canAct(cm, ['CITY_MANAGER'], 'mumbai-id')).toBe(false);
    expect(canAct(cm, ['CITY_MANAGER'])).toBe(true);
    expect(canAct(cm, ['QUALITY_MANAGER'], surat)).toBe(false);
    expect(canAct([{ role: 'QUALITY_MANAGER', cityId: null }], ['QUALITY_MANAGER'], surat)).toBe(
      true,
    );
  });
});
