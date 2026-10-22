import { describe, expect, it } from 'vitest';
import { LEGAL, TO_BE_CONFIRMED, unresolvedFields } from './config';

describe('legal config', () => {
  it('uses Clicko as the legal entity (confirmed by Darshil, 22 Oct 2026)', () => {
    expect(LEGAL.entityName).toBe('Clicko');
  });

  it('carries the ADR-0005 decisions', () => {
    expect(LEGAL.gst).toBe('EXCLUSIVE');
    expect(LEGAL.jurisdiction).toBe('Surat, Gujarat');
    expect(LEGAL.equipmentCapRupees).toBe(200_000);
  });

  it('lists every field still waiting on the owner', () => {
    const pending = unresolvedFields(LEGAL);
    expect(pending).toContain('registeredAddress');
    expect(pending).toContain('grievanceOfficer.name');
    expect(pending).not.toContain('entityName');
  });

  it('treats only the sentinel as unresolved', () => {
    expect(unresolvedFields({ ...LEGAL, registeredAddress: '12 Ring Road, Surat' })).not.toContain(
      'registeredAddress',
    );
    expect(TO_BE_CONFIRMED).toMatch(/confirmed/i);
  });
});
