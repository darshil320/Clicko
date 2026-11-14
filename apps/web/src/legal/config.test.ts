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
    expect(pending).toEqual(
      expect.arrayContaining([
        'registeredAddress',
        'privacyEmail',
        'grievanceOfficer.email',
        'grievanceOfficer.phone',
        'grievanceOfficer.address',
      ]),
    );
    expect(pending).not.toContain('entityName');
  });

  it('treats the sentinel as unresolved', () => {
    expect(
      unresolvedFields({ ...LEGAL, registeredAddress: '12 Ring Road, Surat 395002' }),
    ).not.toContain('registeredAddress');
    expect(TO_BE_CONFIRMED).toMatch(/confirmed/i);
  });

  it('names the Grievance Officer (Darshil, 14 Nov 2026)', () => {
    expect(LEGAL.grievanceOfficer.name).toBe('Mehang Desai');
    expect(unresolvedFields(LEGAL)).not.toContain('grievanceOfficer.name');
  });

  // E-Commerce Rules 2020 r.4(1)(b), r.4(4): an address must be a postal address, not a city.
  it('treats an address without a six-digit pincode as unresolved', () => {
    const cityOnly = {
      ...LEGAL,
      registeredAddress: 'Surat, Gujarat',
      grievanceOfficer: { ...LEGAL.grievanceOfficer, address: 'Surat, Gujarat' },
    };
    expect(unresolvedFields(cityOnly)).toEqual(
      expect.arrayContaining(['registeredAddress', 'grievanceOfficer.address']),
    );
    const postal = {
      ...cityOnly,
      registeredAddress: '12 Ring Road, Surat, Gujarat 395002',
      grievanceOfficer: { ...cityOnly.grievanceOfficer, address: '12 Ring Road, Surat 395002' },
    };
    expect(unresolvedFields(postal)).not.toContain('registeredAddress');
    expect(unresolvedFields(postal)).not.toContain('grievanceOfficer.address');
  });

  it('treats an email without an @ as unresolved', () => {
    const bad = { ...LEGAL, privacyEmail: 'privacy' };
    expect(unresolvedFields(bad)).toContain('privacyEmail');
    expect(unresolvedFields({ ...LEGAL, privacyEmail: 'privacy@clickco.in' })).not.toContain(
      'privacyEmail',
    );
  });
});
