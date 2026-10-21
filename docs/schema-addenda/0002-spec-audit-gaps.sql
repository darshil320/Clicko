-- ============================================================================
-- CLICKCO — SCHEMA ADDENDUM 0002 · SPEC-AUDIT gaps SA-01, SA-02
-- Additive only. Applied after clickco-04-schema.sql (migration 0001).
-- Same conventions: BIGINT paise, timestamptz, append-only where noted.
-- ============================================================================

-- SA-01 · T&C §8.2 — equipment damage claims against a client, capped per
-- incident (OD-08: ₹2,00,000 = 20000000 paise, held in config, enforced here).
CREATE TABLE equipment_claims (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id            uuid NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT,
  photographer_id       uuid NOT NULL REFERENCES photographers(id),
  reported_at           timestamptz NOT NULL DEFAULT now(),
  incident_at           timestamptz NOT NULL,
  -- CLIENT | GUEST | VENUE_CONDITION
  cause                 text NOT NULL,
  description           text NOT NULL,
  -- media_assets / uploaded evidence: repair quotes, invoices, photos
  evidence              jsonb NOT NULL DEFAULT '[]'::jsonb,
  claimed_amount_paise  bigint NOT NULL,
  cap_paise             bigint NOT NULL DEFAULT 20000000,
  approved_amount_paise bigint,
  -- OPEN | UNDER_REVIEW | APPROVED | REJECTED | RECOVERED | WRITTEN_OFF
  status                text NOT NULL DEFAULT 'OPEN',
  reviewed_by           uuid REFERENCES staff_users(id),
  resolution_note       text,
  resolved_at           timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT equipment_claims_cause_valid CHECK (cause IN ('CLIENT','GUEST','VENUE_CONDITION')),
  CONSTRAINT equipment_claims_status_valid CHECK (status IN
    ('OPEN','UNDER_REVIEW','APPROVED','REJECTED','RECOVERED','WRITTEN_OFF')),
  CONSTRAINT equipment_claims_amounts_nonneg CHECK (
    claimed_amount_paise >= 0 AND cap_paise >= 0
    AND (approved_amount_paise IS NULL OR approved_amount_paise >= 0)
  ),
  CONSTRAINT equipment_claims_within_cap CHECK (
    approved_amount_paise IS NULL OR approved_amount_paise <= cap_paise
  ),
  CONSTRAINT equipment_claims_evidence_on_approval CHECK (
    status NOT IN ('APPROVED','RECOVERED') OR jsonb_array_length(evidence) > 0
  )
);
CREATE INDEX equipment_claims_open_idx ON equipment_claims (reported_at)
  WHERE status IN ('OPEN','UNDER_REVIEW');
CREATE INDEX equipment_claims_booking_idx ON equipment_claims (booking_id);
CREATE TRIGGER equipment_claims_touch BEFORE UPDATE ON equipment_claims
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- SA-02 · T&C §12 + Consumer Protection (E-Commerce) Rules 2020 —
-- grievances acknowledged within 48h, resolved within 30 days. Booking is
-- optional: a data-deletion request (T&C §11.4) has no booking.
CREATE TABLE support_tickets (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference          text NOT NULL DEFAULT ('TKT-' || nextval('booking_reference_seq')),
  -- USER | PHOTOGRAPHER | PUBLIC (web form, not logged in)
  raised_by_kind     text NOT NULL,
  user_id            uuid REFERENCES users(id),
  photographer_id    uuid REFERENCES photographers(id),
  contact_name       text NOT NULL,
  contact_phone      text,
  contact_email      text,
  booking_id         uuid REFERENCES bookings(id),
  -- GRIEVANCE | DATA_DELETION | CONSENT_WITHDRAWAL | BILLING | QUALITY
  -- | CONDUCT | APP_ISSUE | OTHER
  category           text NOT NULL,
  is_grievance       boolean NOT NULL DEFAULT false,
  subject            text NOT NULL,
  -- OPEN | ACKNOWLEDGED | IN_PROGRESS | AWAITING_CUSTOMER | RESOLVED | CLOSED
  status             text NOT NULL DEFAULT 'OPEN',
  assigned_to        uuid REFERENCES staff_users(id),
  received_at        timestamptz NOT NULL DEFAULT now(),
  ack_due_at         timestamptz NOT NULL DEFAULT (now() + interval '48 hours'),
  acknowledged_at    timestamptz,
  resolve_due_at     timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  resolved_at        timestamptz,
  resolution_summary text,
  -- links to the booking-scoped queues when a ticket escalates into one
  quality_escalation_id uuid REFERENCES quality_escalations(id),
  dispute_id            uuid REFERENCES disputes(id),
  equipment_claim_id    uuid REFERENCES equipment_claims(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT support_tickets_raiser_valid CHECK (raised_by_kind IN ('USER','PHOTOGRAPHER','PUBLIC')),
  CONSTRAINT support_tickets_category_valid CHECK (category IN
    ('GRIEVANCE','DATA_DELETION','CONSENT_WITHDRAWAL','BILLING','QUALITY',
     'CONDUCT','APP_ISSUE','OTHER')),
  CONSTRAINT support_tickets_status_valid CHECK (status IN
    ('OPEN','ACKNOWLEDGED','IN_PROGRESS','AWAITING_CUSTOMER','RESOLVED','CLOSED')),
  CONSTRAINT support_tickets_contactable CHECK (
    contact_phone IS NOT NULL OR contact_email IS NOT NULL
  ),
  CONSTRAINT support_tickets_ack_before_resolve CHECK (
    resolved_at IS NULL OR acknowledged_at IS NOT NULL
  )
);
CREATE UNIQUE INDEX support_tickets_reference_uq ON support_tickets (reference);
-- the grievance board: open tickets ordered by the nearest statutory clock
CREATE INDEX support_tickets_ack_due_idx ON support_tickets (ack_due_at)
  WHERE acknowledged_at IS NULL;
CREATE INDEX support_tickets_resolve_due_idx ON support_tickets (resolve_due_at)
  WHERE resolved_at IS NULL;
CREATE INDEX support_tickets_user_idx ON support_tickets (user_id, created_at DESC);
CREATE TRIGGER support_tickets_touch BEFORE UPDATE ON support_tickets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Append-only conversation log. A grievance trail is evidence.
CREATE TABLE ticket_messages (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id      uuid NOT NULL REFERENCES support_tickets(id) ON DELETE RESTRICT,
  -- CUSTOMER | STAFF | SYSTEM
  author_kind    text NOT NULL,
  author_id      uuid,
  body           text NOT NULL,
  attachments    jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_internal    boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ticket_messages_author_valid CHECK (author_kind IN ('CUSTOMER','STAFF','SYSTEM'))
);
CREATE INDEX ticket_messages_ticket_idx ON ticket_messages (ticket_id, created_at);
CREATE TRIGGER ticket_messages_append_only
  BEFORE UPDATE OR DELETE ON ticket_messages
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
