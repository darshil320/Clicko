import { LEGAL } from '../src/legal/config';

export default function Home() {
  return (
    <>
      <h1>{LEGAL.brandName}</h1>
      <p>
        On-demand professional photography. Booking opens soon in Surat and Mumbai, with Vadodara in
        pilot.
      </p>
      <p>
        Read our <a href="/terms/">Terms &amp; Conditions</a>,{' '}
        <a href="/refund-policy/">Refund &amp; Cancellation Policy</a> and{' '}
        <a href="/privacy/">Privacy Policy</a>.
      </p>
    </>
  );
}
