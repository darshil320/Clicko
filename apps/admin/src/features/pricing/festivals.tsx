'use client';

import { PricingFestivalFields, type PricingFestivalRow } from '@clickco/contracts';
import {
  Badge,
  Button,
  Checkbox,
  EmptyState,
  Field,
  Input,
  Label,
  PlusIcon,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SideSheet,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@clickco/ui-web';
import { useQuery } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { adminApi } from '../../shared/api';
import { formatDay } from '../../shared/format';
import { keys } from '../../shared/query';
import { bpsToFactor, factorToBps, upliftLabel } from './pricing-format';
import type { TableProps } from './rate-tables';

const ALL_CITIES = 'ALL';
type Editing = { readonly row: PricingFestivalRow | null } | null;

/**
 * Festival and season prices (doc 05 §3 step 7): overlapping dates take the higher factor, never
 * both. Peak season matters to cancellations (T&C §3.2), so it is shown on every row.
 */
export function FestivalsTable({ ruleset, save, changed }: TableProps) {
  const [editing, setEditing] = useState<Editing>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const key = (f: PricingFestivalRow) =>
    `FESTIVAL:${f.label}:${f.dateFrom}:${f.dateTo}:${f.cityId ?? 'ALL'}`;

  return (
    <div className="grid gap-3">
      {save ? (
        <div>
          <Button variant="outline" onClick={() => setEditing({ row: null })}>
            <PlusIcon />
            Add festival dates
          </Button>
        </div>
      ) : null}
      {ruleset.festivals.length === 0 ? (
        <EmptyState title="No festival prices" description="Every date uses the normal rates." />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Dates</TableHead>
              <TableHead>City</TableHead>
              <TableHead className="text-right">Price factor</TableHead>
              <TableHead>Peak season</TableHead>
              {save ? (
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              ) : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {ruleset.festivals.map((f) => (
              <TableRow key={f.id}>
                <TableCell className={changed.has(key(f)) ? 'font-semibold' : 'font-medium'}>
                  {f.label}
                </TableCell>
                <TableCell>
                  {formatDay(f.dateFrom)} – {formatDay(f.dateTo)}
                </TableCell>
                <TableCell>{f.cityName ?? 'All cities'}</TableCell>
                <TableCell className="text-right">
                  {bpsToFactor(f.multiplierBps)}{' '}
                  <span className="text-muted-foreground">({upliftLabel(f.multiplierBps)})</span>
                </TableCell>
                <TableCell>
                  {f.isPeakSeason ? <Badge variant="warning">Peak</Badge> : 'No'}
                </TableCell>
                {save ? (
                  <TableCell>
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="outline" onClick={() => setEditing({ row: f })}>
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={removing === f.id}
                        onClick={async () => {
                          setRemoving(f.id);
                          await save([{ kind: 'FESTIVAL_REMOVE', id: f.id }], `${f.label} removed`);
                          setRemoving(null);
                        }}
                      >
                        Remove
                      </Button>
                    </div>
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {editing && save ? (
        <FestivalSheet row={editing.row} save={save} onClose={() => setEditing(null)} />
      ) : null}
    </div>
  );
}

function FestivalSheet({
  row,
  save,
  onClose,
}: {
  readonly row: PricingFestivalRow | null;
  readonly save: NonNullable<TableProps['save']>;
  readonly onClose: () => void;
}) {
  const cities = useQuery({ queryKey: keys.cities, queryFn: () => adminApi.cities() });
  const [label, setLabel] = useState(row?.label ?? '');
  const [dateFrom, setDateFrom] = useState(row?.dateFrom ?? '');
  const [dateTo, setDateTo] = useState(row?.dateTo ?? '');
  const [cityId, setCityId] = useState<string>(row?.cityId ?? ALL_CITIES);
  const [factor, setFactor] = useState(row ? (row.multiplierBps / 10_000).toFixed(2) : '1.15');
  const [peak, setPeak] = useState(row?.isPeakSeason ?? false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const multiplierBps = factorToBps(factor);
    const parsed = PricingFestivalFields.safeParse({
      label,
      dateFrom,
      dateTo,
      cityId: cityId === ALL_CITIES ? null : cityId,
      multiplierBps: multiplierBps ?? 0,
      isPeakSeason: peak,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the form');
      return;
    }
    setBusy(true);
    const problem = await save(
      row
        ? [{ kind: 'FESTIVAL_UPDATE', id: row.id, festival: parsed.data }]
        : [{ kind: 'FESTIVAL_ADD', festival: parsed.data }],
      `${parsed.data.label} ${row ? 'updated' : 'added'}`,
    );
    setBusy(false);
    if (problem) setError(problem);
    else onClose();
  };

  return (
    <SideSheet
      open
      onOpenChange={(open) => (!open && !busy ? onClose() : undefined)}
      title={row ? `Edit ${row.label}` : 'Add festival dates'}
      description="Shoots that start on these dates (IST) cost this much more. Overlapping dates use the higher factor."
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="festival-form" disabled={busy}>
            {busy ? <Spinner /> : null}
            {row ? 'Save' : 'Add'}
          </Button>
        </div>
      }
    >
      <form id="festival-form" className="grid gap-4" onSubmit={submit} noValidate>
        <Field label="Name" htmlFor="festival-label">
          <Input id="festival-label" value={label} onChange={(e) => setLabel(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="First day" htmlFor="festival-from">
            <Input
              id="festival-from"
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </Field>
          <Field label="Last day" htmlFor="festival-to">
            <Input
              id="festival-to"
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </Field>
        </div>
        <Field label="City" htmlFor="festival-city">
          <Select value={cityId} onValueChange={setCityId}>
            <SelectTrigger id="festival-city">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_CITIES}>All cities</SelectItem>
              {(cities.data ?? []).map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field
          label="Price factor"
          htmlFor="festival-factor"
          hint={`1.15 means 15% more. Between 1.00 and 2.50.`}
        >
          <Input
            id="festival-factor"
            inputMode="decimal"
            value={factor}
            onChange={(e) => setFactor(e.target.value)}
          />
        </Field>
        <div className="flex items-start gap-3">
          <Checkbox
            id="festival-peak"
            checked={peak}
            onCheckedChange={(v) => setPeak(v === true)}
          />
          <div className="grid gap-1">
            <Label htmlFor="festival-peak">Peak season</Label>
            <p className="text-muted-foreground text-sm">
              Cancelling within 7 days of a peak-season shoot keeps half the advance (T&amp;C §3.2).
            </p>
          </div>
        </div>
        {error ? (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        ) : null}
      </form>
    </SideSheet>
  );
}
