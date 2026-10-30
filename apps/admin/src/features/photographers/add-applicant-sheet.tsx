'use client';

import { AdminCreateApplicantBody, ApplicationSource } from '@clickco/contracts';
import {
  Button,
  Field,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SideSheet,
  Spinner,
} from '@clickco/ui-web';
import { type FormEvent, useState } from 'react';
import { adminApi } from '../../shared/api';
import { useCities } from '../../shared/cities';
import { useAdminMutation } from '../../shared/mutation';
import { fieldError, NoteField } from '../../shared/note-field';
import { SOURCE_LABEL } from './labels';

const FORM_ID = 'add-applicant';

/** "98250 12345" → "+919825012345". */
function phoneE164(text: string): string {
  const digits = text.replace(/\D/g, '');
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  return text.trim();
}

/** A walk-in, referral or outreach applicant starts at "New" on the board. */
export function AddApplicantSheet({
  onClose,
  onCreated,
}: {
  readonly onClose: () => void;
  readonly onCreated: (applicationId: string) => void;
}) {
  const cities = useCities();
  const [fullName, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [cityId, setCity] = useState('');
  const [source, setSource] = useState<ApplicationSource>('WALK_IN');
  const [portfolio, setPortfolio] = useState('');
  const [years, setYears] = useState('');
  const [note, setNote] = useState('');
  const [touched, setTouched] = useState(false);
  const city = cityId || (cities.length === 1 ? (cities[0]?.cityId ?? '') : '');

  const check = AdminCreateApplicantBody.safeParse({
    fullName,
    phone: phoneE164(phone),
    cityId: city,
    source,
    ...(portfolio.trim() ? { portfolioUrl: portfolio.trim() } : {}),
    ...(years.trim() ? { yearsExperience: Number(years) } : {}),
    ...(note.trim() ? { note } : {}),
  });
  const err = (field: string) => (touched ? fieldError(check, field) : null);
  const create = useAdminMutation({
    run: (vars: AdminCreateApplicantBody, idem) => adminApi.supply.applications.create(vars, idem),
    success: (vars) => `${vars.fullName} added to onboarding`,
    invalidate: [['supply']],
    onSuccess: (card) => onCreated(card.id),
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (check.success) create.mutate(check.data);
  };

  return (
    <SideSheet
      open
      onOpenChange={(o) => (o || create.isPending ? undefined : onClose())}
      title="Add applicant"
      description="They start at “New”. Documents come next."
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={create.isPending}>
            Cancel
          </Button>
          <Button type="submit" form={FORM_ID} disabled={create.isPending}>
            {create.isPending ? <Spinner /> : null}
            Add applicant
          </Button>
        </>
      }
    >
      <form id={FORM_ID} className="grid gap-4" onSubmit={submit} noValidate>
        <Field label="Full name" htmlFor="applicant-name" error={err('fullName')}>
          <Input id="applicant-name" value={fullName} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Mobile" htmlFor="applicant-phone" error={err('phone')}>
          <Input
            id="applicant-phone"
            inputMode="tel"
            placeholder="98250 12345"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="City" htmlFor="applicant-city" error={err('cityId') && 'Pick a city'}>
            <Select value={city} onValueChange={setCity}>
              <SelectTrigger id="applicant-city">
                <SelectValue placeholder="Pick a city" />
              </SelectTrigger>
              <SelectContent>
                {cities.map((c) => (
                  <SelectItem key={c.cityId} value={c.cityId}>
                    {c.cityName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Came through" htmlFor="applicant-source">
            <Select value={source} onValueChange={(v) => setSource(ApplicationSource.parse(v))}>
              <SelectTrigger id="applicant-source">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ApplicationSource.options.map((s) => (
                  <SelectItem key={s} value={s}>
                    {SOURCE_LABEL[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Portfolio link (optional)"
            htmlFor="applicant-portfolio"
            error={err('portfolioUrl')}
          >
            <Input
              id="applicant-portfolio"
              type="url"
              placeholder="https://"
              value={portfolio}
              onChange={(e) => setPortfolio(e.target.value)}
            />
          </Field>
          <Field
            label="Years shooting (optional)"
            htmlFor="applicant-years"
            error={err('yearsExperience')}
          >
            <Input
              id="applicant-years"
              inputMode="numeric"
              value={years}
              onChange={(e) => setYears(e.target.value)}
            />
          </Field>
        </div>
        <NoteField id="applicant-note" label="Note" value={note} onChange={setNote} error={null} />
      </form>
    </SideSheet>
  );
}
