'use client';

import { useEffect, useState } from 'react';
import { loadSession, type Session, saveSession } from '../../src/session';
import { BookingPanel } from './booking-panel';
import { CreateBooking } from './create-booking';
import { Login } from './login';

export default function BookingSimulator() {
  const [session, setSession] = useState<Session | null>(null);
  const [bookingId, setBookingId] = useState<string | null>(null);

  useEffect(() => setSession(loadSession()), []);

  return (
    <>
      <h1>Booking simulator</h1>
      <p className="muted">
        The full customer journey against the real API: OTP sign-in → booking with a frozen price →
        advance payment through the sandbox gateway (signed webhook) → confirmed booking, GST
        invoice and balanced ledger.
      </p>
      {session ? (
        <p className="muted">
          Signed in as {session.phone} ·{' '}
          <button
            type="button"
            className="link"
            onClick={() => {
              saveSession(null);
              setSession(null);
              setBookingId(null);
            }}
          >
            sign out
          </button>
        </p>
      ) : (
        <Login onLogin={setSession} />
      )}
      {session && !bookingId ? <CreateBooking session={session} onCreated={setBookingId} /> : null}
      {session && bookingId ? (
        <>
          <BookingPanel session={session} bookingId={bookingId} />
          <button type="button" onClick={() => setBookingId(null)}>
            New booking
          </button>
        </>
      ) : null}
    </>
  );
}
