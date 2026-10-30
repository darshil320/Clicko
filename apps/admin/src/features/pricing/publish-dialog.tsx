'use client';

import { PRICING_EDITOR_LIMITS, pricingVersionFor, StepUpCode } from '@clickco/contracts';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  KeyRoundIcon,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
} from '@clickco/ui-web';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { adminApi } from '../../shared/api';
import { istDay } from '../../shared/format';
import { useAdminMutation } from '../../shared/mutation';
import { useNow } from '../../shared/use-now';
import { publishSentence } from './pricing-format';
import { pricingKeys } from './use-pricing';

type When = 'NOW' | 'LATER';
const DAY_MS = 86_400_000;

/**
 * Publish (ADR-0026 D4): now or at a set IST time, with a fresh 6-digit code from the
 * authenticator app (step-up). It says exactly what will happen before anything does.
 */
export function PublishDialog({
  rulesetId,
  reviewedAt,
  changeCount,
  takenVersions,
  onClose,
}: {
  readonly rulesetId: string;
  /** The draft's updatedAt as reviewed: the code approves exactly that content. */
  readonly reviewedAt: string;
  readonly changeCount: number;
  /** Published versions, so the dialog names the version the server will assign. */
  readonly takenVersions: readonly string[];
  readonly onClose: () => void;
}) {
  const router = useRouter();
  const now = useNow(30_000);
  const [when, setWhen] = useState<When>('NOW');
  const [day, setDay] = useState(() => istDay(now + DAY_MS));
  const [time, setTime] = useState('00:00');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  const at = when === 'LATER' ? Date.parse(`${day}T${time}:00+05:30`) : null;
  const atValid = at === null || (Number.isFinite(at) && at > now);
  const version = pricingVersionFor(istDay(at ?? now), takenVersions);

  const publish = useAdminMutation({
    run: (vars: { code: string; effectiveFrom: string | null }, idem) =>
      adminApi.pricing.publish(rulesetId, { ...vars, expectedUpdatedAt: reviewedAt }, idem),
    success: (_, res) =>
      res.published.state === 'SCHEDULED'
        ? `Version ${res.published.version} is scheduled`
        : `Version ${res.published.version} is live`,
    invalidate: [pricingKeys.all],
    onSuccess: () => {
      onClose();
      router.push('/pricing');
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const parsed = StepUpCode.safeParse(code);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Enter the 6-digit code');
      return;
    }
    if (!atValid || (at === null && when === 'LATER')) {
      setError('Pick a time in the future');
      return;
    }
    setError(null);
    publish.mutate(
      { code: parsed.data, effectiveFrom: at === null ? null : new Date(at).toISOString() },
      { onError: () => setCode('') },
    );
  };

  return (
    <Dialog open onOpenChange={(open) => (!open && !publish.isPending ? onClose() : undefined)}>
      <DialogContent>
        <form className="grid gap-4" onSubmit={submit} noValidate>
          <DialogHeader>
            <DialogTitle>Publish version {version}?</DialogTitle>
            <DialogDescription>
              {changeCount === 1 ? '1 change' : `${changeCount} changes`} from the live rate card.
            </DialogDescription>
          </DialogHeader>
          <Field label="When" htmlFor="publish-when">
            <Select value={when} onValueChange={(v) => setWhen(v as When)}>
              <SelectTrigger id="publish-when">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="NOW">Now</SelectItem>
                <SelectItem value="LATER">At a set time</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {when === 'LATER' ? (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Date" htmlFor="publish-day">
                <Input
                  id="publish-day"
                  type="date"
                  value={day}
                  min={istDay(now)}
                  max={istDay(now + PRICING_EDITOR_LIMITS.maxScheduleDays * DAY_MS)}
                  onChange={(e) => setDay(e.target.value)}
                />
              </Field>
              <Field label="Time (IST)" htmlFor="publish-time">
                <Input
                  id="publish-time"
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                />
              </Field>
            </div>
          ) : null}
          <p className="rounded-md border bg-muted p-3 text-sm">
            {atValid ? publishSentence({ version, at, now }) : 'Pick a time in the future.'}
          </p>
          <Field
            label="Code from your authenticator app"
            htmlFor="publish-code"
            hint="Publishing prices needs a fresh code, even though you are signed in."
            error={error}
          >
            <Input
              id="publish-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              aria-invalid={error ? true : undefined}
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={publish.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={publish.isPending || code.length !== 6}>
              {publish.isPending ? <Spinner /> : <KeyRoundIcon />}
              {when === 'NOW' ? 'Publish now' : 'Schedule'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
