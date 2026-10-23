# ADR-0011 — State-machine amendments found while building Sprint 3

**Status:** Accepted 23 Oct 2026 (on Darshil's behalf; overridable) · DOMAIN.md §2 updated to match.

The Sprint 3 build surfaced three places where DOMAIN.md §2 (synthesised from v0.2 §6/§9) could not be
implemented as written.

1. **Re-dispatch had no transition.** v0.2 says a photographer cancellation "re-dispatch + penalty" and a
   no-show triggers an emergency re-broadcast, but CANCELLED_PRO and PRO_NO_SHOW are terminal.
   → New transition `ASSIGNED / EN_ROUTE → DISPATCHING` (`booking.redispatching`). CANCELLED_PRO and
   PRO_NO_SHOW are reached from DISPATCHING only when the replacement search fails; they stay terminal and refund.
   An unfilled <3h emergency at T-90 min also ends in CANCELLED_PRO with the authorisation released.
2. **QUALITY_ESCALATION was a dead end** reachable before delivery, blocking the balance and closure.
   → Reachable only from DELIVERED; exits to CLOSED when the Quality Manager resolves it. Quality problems
   found before delivery are QA's job (QA does not pass) or DATA_LOSS.
3. **Authorise-only CONFIRMED.** "Invoice issued for the advance" cannot apply when nothing was captured.
   → For HOURS_UNDER_3, CONFIRMED records an authorisation only; the invoice and ledger postings happen at
   capture, which is on photographer acceptance (ADR-0010).
