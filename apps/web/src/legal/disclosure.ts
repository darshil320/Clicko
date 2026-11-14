import { LEGAL, type LegalConfig } from './config';

export interface SellerDisclosure {
  readonly operator: string;
  readonly contact: string;
  readonly grievance: string;
}

/**
 * The seller details every page shows in the footer (E-Commerce Rules 2020 r.4(1), r.4(4)):
 * legal name and address, customer-care contact, and the Grievance Officer.
 */
export function sellerDisclosure(config: LegalConfig = LEGAL): SellerDisclosure {
  const g = config.grievanceOfficer;
  return {
    operator: `${config.brandName} is operated by ${config.entityName}, ${config.registeredAddress}.`,
    contact: `Customer care and privacy: ${config.privacyEmail}.`,
    grievance: `Grievance Officer: ${g.name}, ${g.email}, ${g.phone}.`,
  };
}
