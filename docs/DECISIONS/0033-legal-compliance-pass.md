# ADR-0033 — Legal compliance pass: notice, adults only, consent log, seller disclosure, breach

**Status:** accepted, 14 Nov 2026 (Darshil: "review everything and make it compliant").
**Sources:** DPDP Act 2023 s.5, s.6, s.8(5)–(7), s.9, s.12–14; DPDP Rules 2025 r.3, r.6, r.7, r.10;
Consumer Protection (E-Commerce) Rules 2020 r.4, r.6; CCPA Dark Patterns Guidelines 2023; CERT-In
Directions (28 Apr 2022); Google Play User Data policy. Audit of 14 Nov 2026 (Critical + High rows).
**Not legal advice.** Engineering reading of the statutes; a lawyer should confirm before launch.

## Decisions

- **D1 Production refuses unresolved legal fields.** Vercel runs plain `build`, so the legal render
  is strict whenever `isProductionBuild` (Vercel production, `CLICKCO_DEPLOY=1`, `LEGAL_STRICT=1`).
  Previews still deploy as drafts with the Draft notice. An address without a six-digit pincode and
  an email without `@` count as unresolved, so "Surat" alone cannot ship as an address.
- **D2 Grievance Officer:** Mehang Desai, Surat (Darshil, 14 Nov 2026). Email, phone and street
  address still owed by the owner; production builds fail until they are in `legal/config.ts`.
- **D3 Seller disclosure in every page footer:** legal name, registered address, customer-care
  email, Grievance Officer name, email and phone (E-Com r.4(1), r.4(4)).
- **D4 Privacy notice rewritten** (`apps/web/content/privacy.md`): itemised data for clients and
  photographers (incl. IP on OTP requests, install ID, verification documents, PAN/GSTIN/bank),
  purposes, consents and how to withdraw them, named processors and processing outside India,
  retention per data type, all s.11–14 rights incl. nomination and the Data Protection Board,
  breach notice. It says only what the code does today; WhatsApp STOP and in-app withdrawal are
  "write to us" until built.
- **D5 Adults only (DPDP s.9).** Both apps' sign-in carry an unticked "I am 18 or older and agree to
  the Privacy Policy and Terms" checkbox; no code is sent without it. Self-declaration is the
  proportionate check for a service not directed at children; the stores are rated 18+.
- **D6 Consent log without a schema change.** Every OTP verify carries
  `consent: { adultConfirmed: true, noticeVersion }` (`SIGN_IN_NOTICE_VERSION`, the notice's
  effective date). A new account without it is refused (422 `CONSENT_REQUIRED`). Each accepted
  consent emits `user.consent_recorded` through the outbox in the same transaction; the append-only
  `domain_events` table is the record (s.6(10)). Bump `SIGN_IN_NOTICE_VERSION` with every material
  change to the notice.
- **D7 Children in shoots.** The model-release opt-in now says Clickco never features a photo in
  which a child can be identified, even with the opt-in. Curation of marketing photos must apply it.
- **D8 Pre-payment disclosure (E-Com r.6(5), Dark Patterns).** The review screen shows a peak-season
  card whenever the quote's `isPeakSeason` is true, and the terms sheet lists the actual
  cancellation ladder (ADR-0031) with links to Terms, Refund policy, Privacy and Grievances. The
  delivery line matches T&C §5.1 (48 h from check-out, once the balance is paid).
- **D9 Legal pages one tap away** from both apps' Profile (Privacy, Terms, Grievance Officer).
- **D10 Account deletion web page** `/delete-account/` for Play's Data safety form, matching
  ADR-0030's erased/kept lists exactly.
- **D11 KYC documents purged 180 days** after offboarding or a closed application (daily
  `supply.kyc-purge` job, StoragePort only). No doc set a period; 180 days covers disputes,
  chargebacks and payout/TDS queries. PAN and ID last-4 on the photographer row need their own rule.
- **D12 Breach procedure** in RUNBOOK §12.6: CERT-In 6 hours, Board intimation and affected-person
  notice without delay, Board detailed report within 72 hours, with templates. Log retention of one
  year (r.6) is an open ops task (RUNBOOK §13.15).
- **D13 Video** ships as a videographer add-on (ADR-0032).

## Not done here (Medium/Low rows of the audit)

In-app consent withdrawal and an append-only consent table for the model release; `PATCH /me`;
Pro self-deletion; location retention; PAN encryption; credit redemption and credit terms in the
T&C; WhatsApp STOP webhook and a preferences screen; refund deadline on payments needing review;
reschedule and staff-cancel flows; T&C fairness review (§2.3, §3.8, §7.2, §10.1), the 18+ clause and
an acceptable-use clause in the T&C. The T&C is a read-only spec: its changes need the owner's
sign-off on a v2.1 text.
