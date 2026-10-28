'use client';

import { useEffect, useState } from 'react';
import { DispatchDesk } from './desk';
import { PhotographerSim } from './photographer';

export default function DispatchPage() {
  const [bookingId, setBookingId] = useState('');
  const [watching, setWatching] = useState<string | null>(null);

  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get('booking');
    if (fromUrl) {
      setBookingId(fromUrl);
      setWatching(fromUrl);
    }
  }, []);

  return (
    <>
      <h1>Dispatch desk</h1>
      <p className="muted">
        Watch a confirmed booking cascade through waves (or an emergency broadcast), then act as a
        photographer to accept it. First accept wins; the database guarantees no double booking.
      </p>
      <form
        className="card"
        style={{ display: 'flex', gap: 12, alignItems: 'end' }}
        onSubmit={(e) => {
          e.preventDefault();
          setWatching(bookingId.trim());
        }}
      >
        <label style={{ flex: 1 }}>
          Booking id
          <input value={bookingId} onChange={(e) => setBookingId(e.target.value)} />
        </label>
        <button type="submit">Watch</button>
      </form>
      {watching ? <DispatchDesk bookingId={watching} /> : null}
      <h2>Act as a photographer</h2>
      <PhotographerSim />
    </>
  );
}
