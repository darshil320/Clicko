import { describe, expect, it } from 'vitest';
import { LEGAL } from './config';
import { sellerDisclosure } from './disclosure';

// E-Commerce Rules 2020 r.4(1)(a)-(b) and r.4(4): legal name, address, customer-care contact
// and the Grievance Officer's name and contact, shown prominently on the platform.
describe('sellerDisclosure', () => {
  const complete = {
    ...LEGAL,
    registeredAddress: '12 Ring Road, Surat, Gujarat 395002',
    privacyEmail: 'privacy@clickco.in',
    grievanceOfficer: {
      name: 'Mehang Desai',
      email: 'grievance@clickco.in',
      phone: '+91 98765 43210',
      address: '12 Ring Road, Surat, Gujarat 395002',
    },
  };

  it('names the operator and its registered office', () => {
    expect(sellerDisclosure(complete).operator).toBe(
      'Clickco is operated by Clicko, 12 Ring Road, Surat, Gujarat 395002.',
    );
  });

  it('names the Grievance Officer with an email and a phone', () => {
    expect(sellerDisclosure(complete).grievance).toBe(
      'Grievance Officer: Mehang Desai, grievance@clickco.in, +91 98765 43210.',
    );
  });

  it('gives a customer-care contact', () => {
    expect(sellerDisclosure(complete).contact).toBe(
      'Customer care and privacy: privacy@clickco.in.',
    );
  });
});
