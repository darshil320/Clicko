'use client';

import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import {
  type FieldErrors,
  interpretWaitlistResponse,
  type OutcomeMessage,
  outcomeMessage,
  validateWaitlist,
  type WaitlistField,
  type WaitlistInput,
  type WaitlistOutcome,
  waitlistEndpoint,
} from '../../lib/waitlist';

const ENDPOINT = waitlistEndpoint(process.env.NEXT_PUBLIC_API_URL);
const TIMEOUT_MS = 15_000;
const EMPTY: WaitlistInput = { fullName: '', phone: '', pincode: '', intendedDate: '' };

async function postWaitlist(body: unknown): Promise<WaitlistOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const json: unknown = await response.json().catch(() => null);
    return interpretWaitlistResponse(response.status, json);
  } catch {
    return { kind: 'error' };
  } finally {
    clearTimeout(timer);
  }
}

function todayIso(): string {
  const now = new Date();
  const pad = (n: number) => `${n}`.padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Waitlist capture for pincodes we do not serve yet (v0.2 §7). */
export function WaitlistForm() {
  const id = useId();
  const [values, setValues] = useState<WaitlistInput>(EMPTY);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<OutcomeMessage | null>(null);
  const [minDate, setMinDate] = useState<string | undefined>(undefined);
  const statusRef = useRef<HTMLDivElement>(null);

  // Static HTML is built once; "today" must be computed in the visitor's browser.
  useEffect(() => setMinDate(todayIso()), []);

  const update = (field: WaitlistField) => (event: { target: { value: string } }) =>
    setValues((prev) => ({ ...prev, [field]: event.target.value }));

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const result = validateWaitlist(values);
    if (!result.ok) {
      setErrors(result.errors);
      setMessage(null);
      return;
    }
    setErrors({});
    setBusy(true);
    const outcome = await postWaitlist(result.body);
    setBusy(false);
    setMessage(outcomeMessage(outcome, result.body.pincode));
    if (outcome.kind === 'joined') setValues(EMPTY);
    statusRef.current?.focus();
  };

  const fieldId = (field: WaitlistField) => `${id}-${field}`;
  const errorId = (field: WaitlistField) => `${id}-${field}-error`;
  const a11y = (field: WaitlistField, hintId?: string) => ({
    id: fieldId(field),
    'aria-invalid': errors[field] ? true : undefined,
    'aria-describedby':
      [errors[field] ? errorId(field) : null, hintId ?? null].filter(Boolean).join(' ') ||
      undefined,
  });
  const errorText = (field: WaitlistField) =>
    errors[field] ? (
      <p className="field-error" id={errorId(field)}>
        Error: {errors[field]}
      </p>
    ) : null;

  return (
    <form className="form" onSubmit={onSubmit} noValidate aria-label="Join the Clickco waitlist">
      <div className="form-row">
        <div className="field">
          <label htmlFor={fieldId('fullName')}>Full name</label>
          <input
            className="input"
            type="text"
            name="fullName"
            autoComplete="name"
            maxLength={120}
            value={values.fullName}
            onChange={update('fullName')}
            {...a11y('fullName')}
          />
          {errorText('fullName')}
        </div>
        <div className="field">
          <label htmlFor={fieldId('phone')}>Mobile number</label>
          <div className="input-group">
            <span className="prefix" aria-hidden="true">
              +91
            </span>
            <input
              className="input"
              type="tel"
              name="phone"
              inputMode="numeric"
              autoComplete="tel-national"
              placeholder="98765 43210"
              maxLength={16}
              value={values.phone}
              onChange={update('phone')}
              {...a11y('phone', `${id}-phone-hint`)}
            />
          </div>
          <p className="hint" id={`${id}-phone-hint`}>
            10-digit Indian mobile. We only use it to tell you when we launch near you.
          </p>
          {errorText('phone')}
        </div>
      </div>
      <div className="form-row">
        <div className="field">
          <label htmlFor={fieldId('pincode')}>Pincode of your shoot</label>
          <input
            className="input"
            type="text"
            name="pincode"
            inputMode="numeric"
            autoComplete="postal-code"
            maxLength={6}
            placeholder="380015"
            value={values.pincode}
            onChange={update('pincode')}
            {...a11y('pincode')}
          />
          {errorText('pincode')}
        </div>
        <div className="field">
          <label htmlFor={fieldId('intendedDate')}>Shoot date (optional)</label>
          <input
            className="input"
            type="date"
            name="intendedDate"
            min={minDate}
            value={values.intendedDate}
            onChange={update('intendedDate')}
            {...a11y('intendedDate')}
          />
          {errorText('intendedDate')}
        </div>
      </div>
      <p className="form-consent">
        By joining you agree that Clickco may contact you about its launch in your area. See our{' '}
        <a href="/privacy/">Privacy Policy</a>.
      </p>
      <div>
        <button className="btn btn-primary" type="submit" disabled={busy} aria-busy={busy}>
          {busy ? 'Joining…' : 'Join the waitlist'}
        </button>
      </div>
      <div ref={statusRef} tabIndex={-1} role="status" aria-live="polite">
        {message ? (
          <div className={`notice notice-${message.tone}`}>
            <p className="notice-title">{message.title}</p>
            <p>{message.detail}</p>
          </div>
        ) : null}
      </div>
    </form>
  );
}
