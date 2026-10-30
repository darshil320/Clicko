'use client';

import type {
  AddonCode,
  AdminPricingRuleset,
  PlanTier,
  PricingPreviewSide,
} from '@clickco/contracts';
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  Field,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from '@clickco/ui-web';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { adminApi } from '../../shared/api';
import { describeError } from '../../shared/errors';
import { formatMoney, istDay } from '../../shared/format';
import { keys } from '../../shared/query';
import { changeOf } from './pricing-format';
import { CITY_TIER_LABEL, pricingKeys, TIER_LABEL } from './use-pricing';

const TIERS: readonly PlanTier[] = ['BASIC', 'SEMI_PRO', 'PROFESSIONAL', 'EXPERT', 'SIGNATURE'];
const HOURS = [2, 2.5, 3, 3.5, 4, 5, 6, 8, 10, 12];
const DAY_MS = 86_400_000;

/**
 * The live calculator (doc 05 §11: "non-negotiable"): one shoot priced on this version and on
 * live, side by side, by the real engine on the server. Nothing is booked.
 */
export function PreviewPanel({ ruleset }: { readonly ruleset: AdminPricingRuleset }) {
  const cities = useQuery({ queryKey: keys.cities, queryFn: () => adminApi.cities() });
  const categories = useMemo(
    () => [...new Map(ruleset.categoryUplifts.map((u) => [u.categoryCode, u.categoryName]))],
    [ruleset.categoryUplifts],
  );
  const addons = useMemo(
    () => [...new Map(ruleset.addonPrices.map((a) => [a.addonCode, a.addonName]))],
    [ruleset.addonPrices],
  );
  const [tier, setTier] = useState<PlanTier>('PROFESSIONAL');
  const [category, setCategory] = useState(categories[0]?.[0] ?? 'PORTRAIT');
  const [cityId, setCityId] = useState<string | null>(null);
  const [day, setDay] = useState(() => istDay(Date.now() + 7 * DAY_MS));
  const [time, setTime] = useState('16:30');
  const [hours, setHours] = useState('2');
  const [km, setKm] = useState('');
  const [picked, setPicked] = useState<readonly string[]>([]);

  const city = cityId ?? cities.data?.[0]?.id ?? null;
  const distance = km.trim() === '' ? undefined : Number(km);
  const input =
    city && /^\d{4}-\d{2}-\d{2}$/.test(day) && /^\d{2}:\d{2}$/.test(time)
      ? {
          tier,
          categoryCode: category,
          cityId: city,
          hours: Number(hours),
          scheduledStart: `${day}T${time}:00+05:30`,
          addons: picked as AddonCode[],
          ...(distance !== undefined && Number.isFinite(distance)
            ? { travelDistanceKm: Math.round(distance * 100) / 100 }
            : {}),
        }
      : null;
  const preview = useQuery({
    queryKey: pricingKeys.preview(ruleset.summary.id, input),
    queryFn: () => adminApi.pricing.preview(ruleset.summary.id, input as NonNullable<typeof input>),
    enabled: input !== null,
    placeholderData: keepPreviousData,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Try a quote</CardTitle>
        <CardDescription>
          Priced by the engine on this version and on live. Nothing is booked.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Plan" htmlFor="pv-tier">
            <Select value={tier} onValueChange={(v) => setTier(v as PlanTier)}>
              <SelectTrigger id="pv-tier">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIERS.map((t) => (
                  <SelectItem key={t} value={t}>
                    {TIER_LABEL[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Category" htmlFor="pv-category">
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger id="pv-category">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {categories.map(([code, name]) => (
                  <SelectItem key={code} value={code}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="City" htmlFor="pv-city">
            <Select value={city ?? undefined} onValueChange={setCityId}>
              <SelectTrigger id="pv-city">
                <SelectValue placeholder="City" />
              </SelectTrigger>
              <SelectContent>
                {(cities.data ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Hours" htmlFor="pv-hours">
            <Select value={hours} onValueChange={setHours}>
              <SelectTrigger id="pv-hours">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {HOURS.map((h) => (
                  <SelectItem key={h} value={String(h)}>
                    {h} hours
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Date" htmlFor="pv-day">
            <Input id="pv-day" type="date" value={day} onChange={(e) => setDay(e.target.value)} />
          </Field>
          <Field label="Start (IST)" htmlFor="pv-time">
            <Input
              id="pv-time"
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
            />
          </Field>
          <Field label="Travel (km, optional)" htmlFor="pv-km" className="col-span-2">
            <Input
              id="pv-km"
              inputMode="decimal"
              value={km}
              onChange={(e) => setKm(e.target.value)}
            />
          </Field>
        </div>
        <fieldset className="grid gap-2">
          <legend className="mb-1 font-medium text-sm">Add-ons</legend>
          {addons.map(([code, name]) => (
            <div key={code} className="flex items-center gap-2">
              <Checkbox
                id={`pv-addon-${code}`}
                checked={picked.includes(code)}
                onCheckedChange={(v) =>
                  setPicked(v === true ? [...picked, code] : picked.filter((p) => p !== code))
                }
              />
              <Label htmlFor={`pv-addon-${code}`}>{name}</Label>
            </div>
          ))}
        </fieldset>
        {preview.isLoading ? <Skeleton className="h-40 w-full" /> : null}
        {preview.error ? (
          <p role="alert" className="text-destructive text-sm">
            {describeError(preview.error).message}
          </p>
        ) : null}
        {preview.data ? (
          <Comparison
            draft={preview.data.ruleset}
            live={preview.data.live}
            cityLine={`${preview.data.city.name} · ${CITY_TIER_LABEL[preview.data.city.tier]} city rates`}
          />
        ) : null}
      </CardContent>
    </Card>
  );
}

function Comparison({
  draft,
  live,
  cityLine,
}: {
  readonly draft: PricingPreviewSide;
  readonly live: PricingPreviewSide | null;
  readonly cityLine: string;
}) {
  const total = (s: PricingPreviewSide | null) =>
    s?.result.kind === 'QUOTE' ? s.result.totalPaise : null;
  const before = total(live);
  const after = total(draft);
  const change = before !== null && after !== null ? changeOf(before, after) : null;
  return (
    <div className="grid gap-3" aria-live="polite">
      <p className="text-muted-foreground text-sm">{cityLine}</p>
      <div className="grid grid-cols-2 gap-3">
        <Side title={live ? `Live · ${live.version ?? ''}` : 'Live'} side={live} />
        <Side title={draft.version ? `Version ${draft.version}` : 'This draft'} side={draft} />
      </div>
      {change && before !== null && after !== null ? (
        <p className="text-sm">
          {change.direction === 'same' ? (
            'Same total as live.'
          ) : (
            <>
              {change.direction === 'up' ? 'Costs ' : 'Saves the client '}
              <span className="font-semibold">{formatMoney(Math.abs(after - before))}</span>{' '}
              {change.direction === 'up' ? 'more than live' : ''} ({change.percent})
              {change.large ? (
                <Badge variant="warning" className="ml-2">
                  Big change
                </Badge>
              ) : null}
            </>
          )}
        </p>
      ) : null}
    </div>
  );
}

function Side({
  title,
  side,
}: {
  readonly title: string;
  readonly side: PricingPreviewSide | null;
}) {
  const r = side?.result;
  return (
    <div className="grid content-start gap-1 rounded-md border p-3 text-sm">
      <p className="font-semibold">{title}</p>
      {!r ? <p className="text-muted-foreground">Nothing is live.</p> : null}
      {r?.kind === 'QUOTE_ONLY' ? <p className="text-muted-foreground">Priced by enquiry</p> : null}
      {r?.kind === 'REJECTED' ? <p className="text-destructive">{r.message}</p> : null}
      {r?.kind === 'QUOTE' ? (
        <>
          <p className="font-bold font-display text-2xl tabular-nums">
            {formatMoney(r.totalPaise)}
          </p>
          <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 text-muted-foreground">
            {r.lines
              .filter((l) => l.amountPaise !== undefined)
              .map((l) => (
                <div key={l.code} className="contents">
                  <dt>{l.label}</dt>
                  <dd className="text-right tabular-nums">{formatMoney(l.amountPaise ?? 0)}</dd>
                </div>
              ))}
            <dt>GST {r.gst.rateBps / 100}%</dt>
            <dd className="text-right tabular-nums">
              {formatMoney(r.gst.cgstPaise + r.gst.sgstPaise + r.gst.igstPaise)}
            </dd>
            <dt>Photographer gets</dt>
            <dd className="text-right tabular-nums">{formatMoney(r.expectedPayoutPaise)}</dd>
          </dl>
        </>
      ) : null}
    </div>
  );
}
