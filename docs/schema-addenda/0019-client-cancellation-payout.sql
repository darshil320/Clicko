-- ============================================================================
-- CLICKCO — SCHEMA ADDENDUM 0019 · a payout for a client's late cancellation
-- (DOMAIN §2: any pre-shoot state → CANCELLED_CLIENT; T&C §3.1–§3.3). Additive
-- only: no row changes.
--
--   payouts.basis (addendum 0017) gains
--     CLIENT_CANCELLED  the client cancelled after this photographer accepted
--                       (ASSIGNED / EN_ROUTE) and Clickco kept part of the
--                       client's money under the cancellation ladder. The
--                       photographer is paid their share of what was kept
--                       (payouts/rules/outcome-payouts.ts,
--                       CLIENT_CANCELLATION_PAYOUT — owner-overridable);
--                       basis_bps is that share of the full payout.
--
--   refunds (rule refunds, ADR-0031):
--     + refund_approved_or_by_rule  A refund the ladder decides is written
--                   straight to PROCESSING with no approver (approved_by NULL,
--                   so refund_four_eyes holds). "No approver" can only mean "a
--                   published rule decided it": past REQUESTED (or REJECTED),
--                   a refund has an approver, or it is the client's own
--                   cancellation (USER, CLIENT_CANCEL), or the system's
--                   (SYSTEM, CLIENT_CANCEL or DATA_LOSS — T&C §5.5, a complete
--                   loss refunds in full).
--     + last_sent_at  when the refund last went to the gateway. A refund the
--                   gateway has not answered is re-sent only this long after
--                   its LAST send, never its first (no double refund while the
--                   gateway lags).
--     + rejected_by_rule  a refund still waiting (REQUESTED) or FAILED when the
--                   client cancels is superseded by the ladder's refund: it is
--                   REJECTED with a note and no staff rejecter. The 0005 check
--                   refund_rejection_explained now accepts that, and only that,
--                   in place of rejected_by.
--
-- Grants: only CHECK constraints change on existing mutable tables;
-- migration 0011's privileges on payouts and refunds already cover them.
-- ============================================================================

ALTER TABLE payouts
  DROP CONSTRAINT payout_basis_valid,
  ADD CONSTRAINT payout_basis_valid
    CHECK (basis IN ('DELIVERED', 'DATA_LOSS', 'ACCESS_DENIED', 'CLIENT_ABSENT',
                     'CLIENT_CANCELLED'));

ALTER TABLE refunds
  ADD COLUMN last_sent_at timestamptz,
  ADD COLUMN rejected_by_rule boolean NOT NULL DEFAULT false;

ALTER TABLE refunds
  ADD CONSTRAINT refund_approved_or_by_rule
    CHECK (status IN ('REQUESTED', 'REJECTED')
           OR approved_by IS NOT NULL
           OR (requested_by_kind = 'USER' AND reason_code = 'CLIENT_CANCEL')
           OR (requested_by_kind = 'SYSTEM'
               AND reason_code IN ('CLIENT_CANCEL', 'DATA_LOSS'))),
  DROP CONSTRAINT refund_rejection_explained,
  ADD CONSTRAINT refund_rejection_explained
    CHECK (status <> 'REJECTED'
           OR (decision_note IS NOT NULL
               AND (rejected_by IS NOT NULL OR rejected_by_rule))),
  ADD CONSTRAINT refund_rejected_by_rule_only_rejected
    CHECK (NOT rejected_by_rule OR (status = 'REJECTED' AND rejected_by IS NULL));
