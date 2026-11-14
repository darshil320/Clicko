import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import {
  DRAFT_EFFECTIVE_FROM_SQL,
  DRAFT_EFFECTIVE_TO_SQL,
  draftVersion,
} from '../../../modules/pricing/editor/lifecycle';
import { ADDON_CATALOGUE } from '../../../modules/pricing/engine/launch-ruleset';
import {
  VIDEO_ADDON_CATALOGUE,
  VIDEO_ADDON_PRICES,
  VIDEO_EFFECTIVE_FROM,
  VIDEO_PRICED_CODES,
  VIDEO_RULESET_LABEL,
  VIDEO_RULESET_VERSION,
} from '../../../modules/pricing/engine/video-ruleset';
import { RulesetEditorRepository } from '../../../modules/pricing/repositories/ruleset-editor.repository';
import { appendDomainEvent } from '../../outbox/outbox';

export type VideoSeedResult =
  | { readonly created: true; readonly effectiveFrom: Date }
  | { readonly created: false; readonly reason: 'ALREADY_PRESENT' | 'SUPERSEDED' };

const LIFECYCLE_LOCK = 'clickco:pricing_rulesets:lifecycle';
/** VIDEOGRAPHER's minimum tier before ADR-0034 (ADR-0032). Only that value is moved. */
const PRE_0034_VIDEO_MIN_TIER = 'SEMI_PRO';

/** Never in the past: like the editor (EFFECTIVE_FROM_PAST), a late seed starts the card now. */
function startOf(now: Date): Date {
  const card = new Date(VIDEO_EFFECTIVE_FROM);
  return now.getTime() > card.getTime() ? now : card;
}

/**
 * Catalogue rows for the video card. The catalogue is not versioned, so this is insert-only:
 * reels and raw footage are added with their limit and parent if missing, and VIDEOGRAPHER opens to
 * every tier only while it still has ADR-0032's minimum. An ops edit is never overwritten.
 */
async function alignVideoCatalogue(tx: postgres.TransactionSql): Promise<void> {
  const offset = ADDON_CATALOGUE.length;
  for (const [i, a] of VIDEO_ADDON_CATALOGUE.entries()) {
    await tx`
      INSERT INTO addons (code, name, requires_drone_credentials, requires_airspace_check, min_tier,
        sort_order, max_quantity, requires_addon_id)
      VALUES (${a.code}, ${a.label}, ${a.requiresDroneCredentials}, ${a.requiresAirspaceCheck},
        ${a.minTier}, ${offset + i}, ${a.maxQuantity},
        (SELECT id FROM addons WHERE code = ${a.requiresAddonCode}))
      ON CONFLICT (code) DO NOTHING`;
  }
  const videographer = ADDON_CATALOGUE.find((a) => a.code === 'VIDEOGRAPHER');
  if (!videographer) throw new Error('seed: VIDEOGRAPHER is missing from the launch catalogue');
  await tx`
    UPDATE addons SET min_tier = ${videographer.minTier}
    WHERE code = 'VIDEOGRAPHER' AND min_tier = ${PRE_0034_VIDEO_MIN_TIER}`;
}

/** The video rows replace whatever the copy held for those codes. Runs on the draft only. */
async function applyVideoPrices(tx: postgres.TransactionSql, rulesetId: string): Promise<void> {
  await tx`
    DELETE FROM addon_prices
    WHERE ruleset_id = ${rulesetId}
      AND addon_id IN (SELECT id FROM addons WHERE code IN ${tx([...VIDEO_PRICED_CODES])})`;
  for (const p of VIDEO_ADDON_PRICES) {
    const rows = await tx`
      INSERT INTO addon_prices (ruleset_id, addon_id, tier, city_tier, min_quantity, amount_paise,
        is_per_hour, payout_share_bps)
      SELECT ${rulesetId}, id, ${p.tier}, ${p.cityTier}, ${p.minQuantity},
             ${p.amountPaise.toString()}, ${p.isPerHour}, ${p.payoutShareBps}
      FROM addons WHERE code = ${p.addonCode}
      RETURNING id`;
    if (rows.length !== 1) throw new Error(`seed: add-on ${p.addonCode} is not in the catalogue`);
  }
}

/** The editor's publish trail, with the system as the actor (no staff member published it). */
async function recordPublish(
  tx: postgres.TransactionSql,
  p: { id: string; source: { id: string; version: string }; at: Date; now: Date },
): Promise<void> {
  await appendDomainEvent(tx, {
    eventType: 'pricing.ruleset_published',
    aggregateKind: 'pricing_ruleset',
    aggregateId: p.id,
    payload: {
      version: VIDEO_RULESET_VERSION,
      effective_from: p.at.toISOString(),
      scheduled: p.at.getTime() > p.now.getTime(),
      previous_ruleset_id: p.source.id,
      previous_version: p.source.version,
      published_by: null,
      source: 'seed:ADR-0034',
    },
    occurredAt: p.now,
  });
  await tx`
    INSERT INTO audit_logs (actor_kind, action, entity_kind, entity_id, before_state, after_state,
      occurred_at)
    VALUES ('SYSTEM', 'pricing.publish', 'pricing_ruleset', ${p.id},
      ${tx.json({ live: p.source.version })},
      ${tx.json({ version: VIDEO_RULESET_VERSION, effectiveFrom: p.at.toISOString(), adr: 'ADR-0034' })},
      ${p.now})`;
}

/**
 * Publishes ruleset 2026.11.14 the way the editor does (doc 05 §11, ADR-0026): a draft copying
 * every row of the ruleset in force, the video rows applied to the draft, then the publish — the
 * source closed at the start, a domain event and an audit row in the same transaction. Copying
 * (not rebuilding from the fixture) keeps any rate staff published since launch. Starts on
 * 14 Nov 2026 or `now`, whichever is later. Never edits a published ruleset's prices
 * (Invariant 17). Idempotent. Skips when a ruleset already starts at or after that point: then
 * apply the card in the editor.
 */
export async function seedVideoRuleset(sql: postgres.Sql, now: Date): Promise<VideoSeedResult> {
  const editor = new RulesetEditorRepository(sql);
  const at = startOf(now);
  return sql.begin(async (tx): Promise<VideoSeedResult> => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${LIFECYCLE_LOCK}))`;
    const [existing] =
      await tx`SELECT id FROM pricing_rulesets WHERE version = ${VIDEO_RULESET_VERSION}`;
    if (existing) return { created: false, reason: 'ALREADY_PRESENT' };
    const [later] = await tx`
      SELECT id FROM pricing_rulesets WHERE published_at IS NOT NULL AND effective_from >= ${at}`;
    if (later) return { created: false, reason: 'SUPERSEDED' };
    const [source] = await tx<{ id: string; version: string }[]>`
      SELECT id, version FROM pricing_rulesets
      WHERE published_at IS NOT NULL AND effective_to IS NULL AND effective_from < ${at}`;
    if (!source) throw new Error('seed: publish the launch ruleset first (pnpm db:seed)');

    await alignVideoCatalogue(tx);
    const id = randomUUID();
    await tx`
      INSERT INTO pricing_rulesets (id, version, label, effective_from, effective_to,
        prices_include_gst, gst_rate_bps, sac_code, based_on_id)
      SELECT ${id}, ${draftVersion(id)}, ${VIDEO_RULESET_LABEL},
             ${tx.unsafe(DRAFT_EFFECTIVE_FROM_SQL)}, ${tx.unsafe(DRAFT_EFFECTIVE_TO_SQL)},
             prices_include_gst, gst_rate_bps, sac_code, id
      FROM pricing_rulesets WHERE id = ${source.id}`;
    await editor.copyChildren(tx, source.id, id);
    await applyVideoPrices(tx, id);

    await editor.closeAt(tx, source.id, at);
    await tx`
      UPDATE pricing_rulesets
      SET version = ${VIDEO_RULESET_VERSION}, effective_from = ${at}, effective_to = NULL,
          published_at = ${now}
      WHERE id = ${id}`;
    await recordPublish(tx, { id, source, at, now });
    return { created: true, effectiveFrom: at };
  });
}
