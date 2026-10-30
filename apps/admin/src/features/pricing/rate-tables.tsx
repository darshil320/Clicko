'use client';

import type { AdminPricingRuleset, PlanTier, PricingDraftChange } from '@clickco/contracts';
import {
  Badge,
  InlineEdit,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@clickco/ui-web';
import { formatMoney } from '../../shared/format';
import {
  bpsToFactor,
  bpsToPercentText,
  factorToBps,
  paiseToRupeesText,
  parseRupees,
  percentTextToBps,
  upliftLabel,
} from './pricing-format';
import { CITY_TIER_LABEL, CITY_TIERS, TIER_LABEL } from './use-pricing';

type Save = (changes: PricingDraftChange[], what: string) => Promise<string | null>;

export interface TableProps {
  readonly ruleset: AdminPricingRuleset;
  /** null = read-only (published, discarded, or the caller cannot edit). */
  readonly save: Save | null;
  /** Diff keys that differ from live, to mark changed cells. */
  readonly changed: ReadonlySet<string>;
}

const NOT_AMOUNT = 'Enter an amount in ₹, like 4,250';
const NOT_PERCENT = 'Enter a percentage, like 62 or 62.5';

const TIERS: readonly PlanTier[] = ['BASIC', 'SEMI_PRO', 'PROFESSIONAL', 'EXPERT', 'SIGNATURE'];

/** Hourly rates: tiers down, city tiers across, in ₹. A rate change carries extensions with it. */
export function BaseRatesTable({ ruleset, save, changed }: TableProps) {
  const rate = (tier: PlanTier, cityTier: (typeof CITY_TIERS)[number]) =>
    ruleset.baseRates.find((r) => r.tier === tier && r.cityTier === cityTier);
  return (
    <div className="grid gap-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Plan · per hour</TableHead>
            {CITY_TIERS.map((ct) => (
              <TableHead key={ct} className="text-right">
                {CITY_TIER_LABEL[ct]} cities
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {TIERS.map((tier) => (
            <TableRow key={tier}>
              <TableCell className="font-medium">{TIER_LABEL[tier]}</TableCell>
              {CITY_TIERS.map((ct) => {
                const r = rate(tier, ct);
                if (!r)
                  return (
                    <TableCell key={ct} className="text-right">
                      —
                    </TableCell>
                  );
                if (r.isQuoteOnly) {
                  return (
                    <TableCell key={ct} className="text-right">
                      <Badge variant="outline">By enquiry</Badge>
                    </TableCell>
                  );
                }
                const what = `${TIER_LABEL[tier]}, ${CITY_TIER_LABEL[ct]} cities`;
                return (
                  <TableCell key={ct} className="text-right">
                    <InlineEdit
                      label={`Hourly rate, ${what}`}
                      display={formatMoney(r.ratePerHourPaise)}
                      initial={paiseToRupeesText(r.ratePerHourPaise)}
                      prefix="₹"
                      changed={changed.has(`BASE_RATE:${tier}:${ct}`)}
                      disabled={save === null}
                      onCommit={async (text) => {
                        const paise = parseRupees(text);
                        if (paise === null) return NOT_AMOUNT;
                        if (paise === 0) return 'A bookable plan needs a rate above ₹0';
                        return save
                          ? save(
                              [
                                {
                                  kind: 'BASE_RATE',
                                  id: r.id,
                                  ratePerHourPaise: paise,
                                  payoutShareBps: r.payoutShareBps,
                                  syncExtension: true,
                                },
                              ],
                              `${what} is now ${formatMoney(paise)}/hr`,
                            )
                          : null;
                      }}
                    />
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="text-muted-foreground text-sm">
        Changing an hourly rate also sets that plan's extra-hour rate to match, and waiting time to
        60% of it.
      </p>
      <h3 className="font-semibold">Photographer's share</h3>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Plan</TableHead>
            {CITY_TIERS.map((ct) => (
              <TableHead key={ct} className="text-right">
                {CITY_TIER_LABEL[ct]} cities
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {TIERS.map((tier) => (
            <TableRow key={tier}>
              <TableCell className="font-medium">{TIER_LABEL[tier]}</TableCell>
              {CITY_TIERS.map((ct) => {
                const r = rate(tier, ct);
                if (!r)
                  return (
                    <TableCell key={ct} className="text-right">
                      —
                    </TableCell>
                  );
                const what = `${TIER_LABEL[tier]}, ${CITY_TIER_LABEL[ct]} cities`;
                return (
                  <TableCell key={ct} className="text-right">
                    <InlineEdit
                      label={`Photographer's share, ${what}`}
                      display={`${bpsToPercentText(r.payoutShareBps)}%`}
                      initial={bpsToPercentText(r.payoutShareBps)}
                      suffix="%"
                      disabled={save === null}
                      onCommit={async (text) => {
                        const bps = percentTextToBps(text);
                        if (bps === null || bps > 10_000) return NOT_PERCENT;
                        return save
                          ? save(
                              [
                                {
                                  kind: 'BASE_RATE',
                                  id: r.id,
                                  ratePerHourPaise: r.ratePerHourPaise,
                                  payoutShareBps: bps,
                                  syncExtension: false,
                                },
                              ],
                              `photographer's share for ${what} is ${bpsToPercentText(bps)}%`,
                            )
                          : null;
                      }}
                    />
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/** Category price factors (Wedding 1.25× …), applied to the hourly rate. */
export function CategoriesTable({ ruleset, save, changed }: TableProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Category</TableHead>
          <TableHead className="text-right">Price factor</TableHead>
          <TableHead>Effect</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {ruleset.categoryUplifts.map((u) => (
          <TableRow key={u.id}>
            <TableCell className="font-medium">
              {u.categoryName}
              {u.tier ? ` · ${TIER_LABEL[u.tier]}` : ''}
            </TableCell>
            <TableCell className="text-right">
              <InlineEdit
                label={`Price factor, ${u.categoryName}`}
                display={bpsToFactor(u.multiplierBps)}
                initial={(u.multiplierBps / 10_000).toFixed(2)}
                suffix="×"
                changed={changed.has(`CATEGORY_UPLIFT:${u.categoryCode}:${u.tier ?? 'ALL'}`)}
                disabled={save === null}
                onCommit={async (text) => {
                  const bps = factorToBps(text);
                  if (bps === null) return 'Enter a factor like 1.15';
                  if (bps < 5_000 || bps > 30_000) return 'Between 0.50× and 3.00×';
                  return save
                    ? save(
                        [{ kind: 'CATEGORY_UPLIFT', id: u.id, multiplierBps: bps }],
                        `${u.categoryName} is ${bpsToFactor(bps)}`,
                      )
                    : null;
                }}
              />
            </TableCell>
            <TableCell className="text-muted-foreground">{upliftLabel(u.multiplierBps)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** Add-on prices. Never multiplied by surge or emergency (doc 05 §3 step 10). */
export function AddonsTable({ ruleset, save, changed }: TableProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Add-on</TableHead>
          <TableHead className="text-right">Price</TableHead>
          <TableHead>Charged</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {ruleset.addonPrices.map((a) => (
          <TableRow key={a.id}>
            <TableCell className="font-medium">
              {a.addonName}
              {a.tier ? ` · ${TIER_LABEL[a.tier]}` : ''}
              {a.cityTier ? ` · ${CITY_TIER_LABEL[a.cityTier]} cities` : ''}
            </TableCell>
            <TableCell className="text-right">
              <InlineEdit
                label={`Price, ${a.addonName}`}
                display={formatMoney(a.amountPaise)}
                initial={paiseToRupeesText(a.amountPaise)}
                prefix="₹"
                changed={changed.has(
                  `ADDON_PRICE:${a.addonCode}:${a.tier ?? 'ALL'}:${a.cityTier ?? 'ALL'}`,
                )}
                disabled={save === null}
                onCommit={async (text) => {
                  const paise = parseRupees(text);
                  if (paise === null) return NOT_AMOUNT;
                  return save
                    ? save(
                        [{ kind: 'ADDON_PRICE', id: a.id, amountPaise: paise }],
                        `${a.addonName} is ${formatMoney(paise)}`,
                      )
                    : null;
                }}
              />
            </TableCell>
            <TableCell className="text-muted-foreground">
              {a.isPerHour ? 'Per hour' : 'Once per booking'}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** Extra hours and waiting time, per plan × city tier (before the category factor). */
export function ExtensionsTable({ ruleset, save, changed }: TableProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Plan · cities</TableHead>
          <TableHead className="text-right">Extra hour</TableHead>
          <TableHead className="text-right">Waiting, per hour</TableHead>
          <TableHead>Free waiting</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {ruleset.extensionRates.map((x) => {
          const what = `${TIER_LABEL[x.tier]}, ${CITY_TIER_LABEL[x.cityTier]} cities`;
          const isChanged = changed.has(`EXTENSION_RATE:${x.tier}:${x.cityTier}`);
          const commit =
            (field: 'hourlyPaise' | 'waitingHourlyPaise') =>
            async (text: string): Promise<string | null> => {
              const paise = parseRupees(text);
              if (paise === null) return NOT_AMOUNT;
              const next = { hourlyPaise: x.hourlyPaise, waitingHourlyPaise: x.waitingHourlyPaise };
              return save
                ? save(
                    [{ kind: 'EXTENSION_RATE', id: x.id, ...next, [field]: paise }],
                    `${what} ${field === 'hourlyPaise' ? 'extra hour' : 'waiting'} is ${formatMoney(paise)}`,
                  )
                : null;
            };
          return (
            <TableRow key={x.id}>
              <TableCell className="font-medium">{what}</TableCell>
              <TableCell className="text-right">
                <InlineEdit
                  label={`Extra hour, ${what}`}
                  display={formatMoney(x.hourlyPaise)}
                  initial={paiseToRupeesText(x.hourlyPaise)}
                  prefix="₹"
                  changed={isChanged}
                  disabled={save === null}
                  onCommit={commit('hourlyPaise')}
                />
              </TableCell>
              <TableCell className="text-right">
                <InlineEdit
                  label={`Waiting per hour, ${what}`}
                  display={formatMoney(x.waitingHourlyPaise)}
                  initial={paiseToRupeesText(x.waitingHourlyPaise)}
                  prefix="₹"
                  changed={isChanged}
                  disabled={save === null}
                  onCommit={commit('waitingHourlyPaise')}
                />
              </TableCell>
              <TableCell className="text-muted-foreground">{x.waitingGraceMinutes} min</TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

/** Read-only here: lead-time, night/weekend and travel rules (T&C-bound; ADR-0026 D4 scope). */
export function OtherRulesTable({ ruleset }: { readonly ruleset: AdminPricingRuleset }) {
  const BAND: Record<string, string> = {
    NONE: '2+ days ahead',
    NEXT_DAY: '1–2 days ahead',
    SAME_DAY: '8–24 hours ahead',
    HOURS_3_8: '3–8 hours ahead',
    HOURS_UNDER_3: 'Under 3 hours ahead',
  };
  return (
    <div className="grid gap-4">
      <p className="text-muted-foreground text-sm">
        These follow the terms and conditions and are not edited here.
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Booked</TableHead>
            <TableHead className="text-right">Price factor</TableHead>
            <TableHead>Guaranteed</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {ruleset.emergency.map((e) => (
            <TableRow key={e.band}>
              <TableCell>{BAND[e.band] ?? e.band}</TableCell>
              <TableCell className="text-right">{bpsToFactor(e.multiplierBps)}</TableCell>
              <TableCell>{e.isGuaranteed ? 'Yes' : 'Best effort'}</TableCell>
            </TableRow>
          ))}
          {ruleset.timeMultipliers.map((t) => (
            <TableRow key={t.kind}>
              <TableCell>
                {t.kind === 'NIGHT'
                  ? `Night start (${t.windowStart}–${t.windowEnd})`
                  : 'Weekend (Sat, Sun)'}
              </TableCell>
              <TableCell className="text-right">{bpsToFactor(t.multiplierBps)}</TableCell>
              <TableCell>—</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Travel · cities</TableHead>
            <TableHead>Distance</TableHead>
            <TableHead className="text-right">Flat</TableHead>
            <TableHead className="text-right">Per km</TableHead>
            <TableHead className="text-right">Overnight</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {ruleset.travelSlabs.map((s) => (
            <TableRow key={`${s.cityTier}-${s.zone}`}>
              <TableCell>
                {CITY_TIER_LABEL[s.cityTier]} · zone {s.zone}
              </TableCell>
              <TableCell>
                {s.fromKm}–{s.toKm ?? '∞'} km
              </TableCell>
              <TableCell className="text-right">{formatMoney(s.flatPaise)}</TableCell>
              <TableCell className="text-right">{formatMoney(s.perKmPaise)}</TableCell>
              <TableCell className="text-right">{formatMoney(s.overnightPaise)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
