# CLICKCO — v0.2 LOCKED SPEC
**Decisions confirmed · Contradictions resolved · Remaining risks flagged**
Supersedes v0.1 where they differ · Owner: DMC Tech · 28 Jul 2026

---

## 1. Locked decisions

| # | Decision | Locked |
|---|---|---|
| Structure | **Principal / seller of record.** Clickco sells the shoot; photographers are contracted vendors. | ✅ |
| Storage | **Google Drive, 5 TB**, tripwire at ~35 events/day (§5) | ✅ |
| Editing | **Not included in the 48h SLA.** RAW delivery only. Editing is a separate paid product with its own turnaround, served by a central editor pool. | ✅ |
| Geography | Brand + app **pan-India**; fulfilment gated to **Surat, Mumbai, Vadodara**; every other pincode → waitlist | ✅ |
| Plans | Basic · Semi-Pro · Professional · Expert · **Signature** | ✅ |
| RAW retention | **7 days** from delivery, then permanent delete | ✅ |
| Licensing | Single price. Personal *and* commercial use both permitted. Copyright retained by Clickco. | ✅ |
| Drone | Add as paid addon | ✅ |
| Client selection flow | Dropped | ✅ |
| Physical deliverables | Dropped | ✅ |
| Standby roster | Dropped — emergency is best-effort | ✅ |
| Referral engine | Deferred | ✅ |
| B2B accounts | Manual, offline | ✅ |
| Equipment insurance | Not Clickco's — photographers own their gear | ✅ |
| Funding | DMC-funded | ✅ |

---

## 2. Five contradictions — resolved

These conflict inside your own answers. Here's the resolution I've built the rest of the doc on. Correct me where I've guessed wrong.

| Conflict | Resolution |
|---|---|
| "Pan-India from launch" vs "Mumbai, Surat, Vadodara" | **Pan-India brand, gated fulfilment.** App downloadable and browsable everywhere; pincode check at booking. Serviceable → book. Non-serviceable → waitlist capture ("we're coming to Chennai — 340 people waiting"). Waitlist volume becomes your city-launch priority queue. Zero failed bookings, full national SEO surface. |
| "No editing in 48 hours" vs "Editing — central pool" | **Two separate products.** (a) *Raw Delivery* — included, 24–48h SLA, no human touch. (b) *Clickco Edit* — paid addon, priced per 50 photos, 5–7 day SLA, central editor pool. Marketed as an upsell after delivery, when the client has seen the files and wants the best 40 finished. Higher attach rate post-delivery than pre. |
| RAW retention **7 days** vs T&C §4.2 allowing delivery up to **1 week** | Retention clock must start at **delivery**, not shoot. Otherwise a delayed shoot deletes its own files before the client downloads. Locked: retention = delivery + 7 days. |
| "No standby roster" vs emergency-in-3-hours promise | Emergency tier becomes **best-effort with instant refund**, not a guarantee (§8). Language matters legally — see T&C v2 §5. |
| Photographer no-show "not possible" | No-shows happen — illness, accidents, breakdowns. Not a policy option. Minimum viable handling in §9. |

---

## 3. The RAW delivery problem

Your model is now: photographer shoots → uploads RAW → client downloads RAW. Three things break.

**3.1 RAW video is not viable.** True RAW video (BRAW, ProRes RAW, CDNG) runs 2–4 GB per minute. Twenty minutes of clips = 40–80 GB per event. At that rate 5 TB holds ~60 events and Drive's daily upload ceiling caps you at ~10 events/day.

> **Fix:** T&C §3.2 rewritten to *"photographs are delivered as unedited camera RAW; video is delivered as unedited camera-original recordings (compressed codec)."* Camera-original h.264/h.265 is ~200–400 MB/minute — 8 GB for 20 minutes. Manageable.

**3.2 Clients cannot open RAW files.** `.CR3`, `.ARW`, `.NEF` need Lightroom or Camera Raw. Your Basic-tier birthday-party client has neither. They will open the Drive link, see 600 unopenable files, and raise a refund request. This is not a hypothetical — it's the most predictable support ticket in your business.

> **Fix:** **Automated JPEG export.** Server-side batch convert every RAW to a full-resolution JPEG using `darktable-cli` or `rawtherapee-cli` with a neutral profile. No human involved, no editorial judgment, ~2–4 seconds per file on a modest worker. This is *not* editing — it's format conversion, and it should be positioned exactly that way in your T&C so it doesn't undercut the paid Edit product.
>
> Delivery becomes: **JPEG folder (primary, ~6 GB) + RAW folder (available 7 days, ~18 GB).**

**3.3 Drive cannot zip a folder that large.** Drive's server-side zip fails or truncates on large folders and multi-GB downloads. A client on mobile trying to pull 18 GB will never complete it.

> **Fix:** JPEGs become the default download path (small enough to work). RAW is offered as "download via desktop within 7 days," with an explicit warning about size. Split RAW into sub-folders of ≤2 GB.

**3.4 Storage impact of the fix**

| | Per event |
|---|---|
| RAW photos (600 × 30 MB) | 18 GB |
| Exported JPEGs (600 × 10 MB) | 6 GB |
| Camera-original video (20 min) | 8 GB |
| **Total during 7-day window** | **~32 GB** |
| **After RAW deletion (day 8+)** | ~6 GB, or 0 if you delete everything |

**Recommendation:** delete RAW at delivery + 7 days, keep JPEGs for delivery + 30 days. Storage becomes a rolling window, not an accumulating debt.

---

## 4. Media pipeline (Drive edition)

```
PHOTOGRAPHER (Clickco Pro app OR web upload portal)
  │
  │  ── resumable chunked upload to CLICKCO BACKEND (not to Drive directly)
  │     • photographer never touches Drive credentials
  │     • upload resumes across network drops
  │     • per-file checksum; server rejects truncated files
  ▼
CLICKCO UPLOAD SERVICE  (staging disk / temp volume)
  │
  ├─► integrity check: file count vs declared, checksum, corrupt-RAW detection
  ├─► RAW → JPEG batch export worker (darktable-cli, neutral profile)
  ├─► virus scan
  ▼
GOOGLE DRIVE  (Shared Drive, service-account owned)
  /Clickco/{YYYY-MM}/{booking_id}/
      ├── /Photos-JPEG/          ← primary client download
      ├── /Photos-RAW/part-01…   ← ≤2 GB sub-folders, 7-day life
      └── /Video/
  │
  ├─► Drive permissions: link NOT created until final payment cleared
  ├─► on payment → generate restricted link, email/WhatsApp to client
  ├─► scheduled job: revoke link at delivery+30d
  └─► scheduled job: PERMANENT delete RAW at delivery+7d
        ⚠ must use files.delete, not trash — Drive trash counts
          against quota and auto-empties only at 30 days
```

**Non-negotiables for this to work:**

| Item | Why |
|---|---|
| Photographers upload to **your backend**, never to Drive | Otherwise you hand out Drive access and lose all control, integrity checking, and quota management |
| **Service account + Shared Drive**, not a personal Drive | Personal Drive dies with the account; Shared Drive survives staff changes |
| **Permanent delete**, not trash | Trashed files still consume your 5 TB for 30 days |
| **Upload throttling queue** | Drive API: ~750 GB/day and per-100-second request quotas. Serialise through BullMQ with backoff on 403 rateLimitExceeded. |
| **Quota monitor + alerting** at 60/75/90% | You need 3 weeks of warning, not 3 hours |
| **Weekly integrity audit job** | Verify file counts per booking against expected; catch silent upload failures |

---

## 5. Drive tripwire — when this breaks

Two independent ceilings, and they land in the same place.

| Ceiling | Calculation | Limit |
|---|---|---|
| **Storage** | 5,120 GB ÷ 32 GB per event, 7-day rolling window | ~160 events in flight → **~23 events/day** |
| **Drive API upload** | 750 GB/day ÷ 32 GB per event | **~23 events/day** |
| **Shared Drive item cap** | 500,000 items ÷ ~1,200 files per event | Not binding with 7-day deletion |

**With RAW deleted aggressively (JPEG-only after day 7):** storage ceiling moves to ~50 events/day, but the **API upload ceiling stays at ~23/day** — that one you cannot engineer around on Drive.

> **Tripwire: at a sustained 18 events/day, start the migration.** That's roughly ₹2.5–3.5 L/day of bookings — a genuinely good problem. Migration path is pre-built into the pipeline above: your backend already owns the upload, so switching the destination from Drive to Cloudflare R2 is one adapter class, not a rewrite. **Build the storage layer behind an interface from day one.** That single decision costs you two days now and saves a quarter later.

---

## 6. Revised booking lifecycle

Selection and editing removed; payment-gated delivery added.

```
DRAFT → QUOTED → ADVANCE_PENDING (50%)
  → CONFIRMED
  → DISPATCHING          (cascade; §9)
  → ASSIGNED
  → EN_ROUTE             (T-60m, live location to client)
  → CHECKED_IN           (geofenced; billing clock starts)   ← G-15
  → IN_PROGRESS
      └─ EXTENSION_REQUESTED → EXTENSION_APPROVED (1 hr blocks)  ← G-16
  → CHECKED_OUT          (geofenced; SLA T0 starts here)
  → UPLOADING            (proxy-free; integrity-checked)
  → PROCESSING           (auto JPEG export)
  → QA                   (ops: file count, obvious corruption)
  → BALANCE_PENDING      (50% invoice sent; NO media released)  ← G-27
  → DELIVERED            (Drive link issued on payment clear)
  → CLOSED               (auto +30d; RAW purged at +7d)

Exceptions:
  CANCELLED_CLIENT   → refund ladder (T&C §2)
  CANCELLED_PRO      → re-dispatch + penalty
  PRO_NO_SHOW        → §9
  ACCESS_DENIED      → 50% charge, closed              ← G-18
  UNSAFE_SITE        → ops-approved abort, partial charge
  DATA_LOSS          → full client refund + full pro payout  ← G-13
  QUALITY_ESCALATION → Quality Manager queue           ← G-07
  ABANDONED          → balance unpaid 30d, media purged, booking closed
```

**Important:** the SLA clock starts at **CHECKED_OUT**, and the *delivery* clock pauses at `BALANCE_PENDING` — you cannot be liable for a 48h breach caused by the client not paying. Track two clocks: `production_sla` (yours) and `time_to_payment` (theirs). Publish only the first.

---

## 7. Serviceability & waitlist (G-22)

```
ServiceableArea
  ├── pincode (PK)
  ├── city_id
  ├── status: LIVE | PILOT | WAITLIST | BLOCKED
  ├── travel_zone: 0 (≤15km) | 1 (15–40km) | 2 (outstation)
  └── surcharge_amount

Booking flow:
  pincode entered
    → LIVE      : proceed
    → PILOT     : proceed with "limited availability" banner, longer accept window
    → WAITLIST  : capture name + phone + event date + category
                  → show "X people waiting in {city}"
                  → notify on launch
    → BLOCKED   : polite decline
```

Waitlist is a **growth asset**, not a consolation. Ops dashboard ranks non-live cities by waitlist volume × average intended spend. That's your expansion roadmap, generated by demand instead of guesswork.

Launch config: Surat `LIVE` · Mumbai `LIVE` · Vadodara `PILOT` · everything else `WAITLIST`.

---

## 8. Emergency tier without a standby roster

You've dropped standby, which means the promise has to change or you'll be refunding constantly and eating app-store reviews.

**Honest structure:**

| Lead time | Multiplier | Language you can defend | If unfilled |
|---|---|---|---|
| < 3 h | 2.2× | "Best effort — we'll try to fill in 3 hours" | Auto full refund at T-90min, no charge |
| 3–8 h | 1.8× | "Usually filled within the hour" | Auto full refund |
| Same day | 1.4× | "High availability" | Auto full refund |
| Next day | 1.2× | "Confirmed" | Full refund |

**Mechanics that make this work without standby:**

1. **Authorise, don't capture.** Card/UPI mandate authorised at booking, captured only on photographer acceptance. No money moves until supply is confirmed — this alone eliminates most emergency-tier disputes.
2. **Broadcast wide, immediately.** Skip the wave cascade for emergency; push to every eligible photographer in the city at once, first-accept-wins with a Redis lock.
3. **WhatsApp + voice call** on emergency dispatch, not just push notification. Push notifications get missed; a ringing phone doesn't.
4. **Emergency opt-in flag** on photographer profiles. Only notify people who've said yes. Show them their emergency accept-rate — it's a ranking input.
5. **Hard auto-refund timer.** If unfilled at T-90 minutes, cancel and refund automatically. Never let a client discover at T-30 that nobody is coming.

You can add a paid standby roster later once you know your emergency fill rate. Measure it from week one.

---

## 9. Photographer no-show — minimum viable handling

"Not possible" isn't available as a policy. Photographers get sick, crash bikes, and double-book. At 20 bookings/day you'll see one every week or two. What you need is small:

```
Trigger: no CHECKED_IN event by scheduled_start + 15 min
  → auto SMS + call to photographer
  → +5 min no response → ops desk alert (loud) + client notified proactively
  → parallel emergency broadcast to city (nearest first, 2.0× incentive)
  → filled?  YES → client informed of new ETA + 25% credit for the delay
             NO  → full refund + ₹500 credit + apology call from a human

Photographer consequence:
  1st  → warning, logged
  2nd  → 7-day deactivation
  3rd  → removed from platform
Exception: verified emergency (medical, accident) with proof → no penalty
```

**T&C gap:** your §2.4 only covers Clickco cancelling a week ahead. There's nothing covering same-day failure. Added as §2.6 in T&C v2.

---

## 10. Signature tier (Plan 5)

| | Signature |
|---|---|
| Positioning | Brand campaigns, luxury weddings, celebrity, architectural, editorial |
| Pricing | Quote-only. No published rate card. Minimum 4 hours. |
| Booking | Enquiry form → ops call → custom quote → 50% advance. **Not instant-bookable.** |
| Photographer | Hand-picked and named. Client sees and approves the specific portfolio before confirming. |
| Included | Second shooter, full lighting kit, on-site backup, Clickco Edit included, 24h delivery option |
| Ops | Assigned account manager for the booking |
| Why it matters | Anchors your price ladder upward and makes Expert look reasonable. Even at low volume it lifts perceived value across every tier. |

### The business subscription you declined — in plain terms

A restaurant needs new food photos every month for menus, Swiggy/Zomato listings and Instagram. Instead of booking one shoot at a time, they pay a fixed monthly fee — say ₹12,000 — for two 2-hour shoots per month. You bill their card automatically on the 1st.

Why it's structurally different from everything else you sell: you acquire that customer **once** and earn from them twelve times. Every other Clickco booking is a one-off — you pay marketing cost again for every single sale, and a birthday party client won't buy again for a year. It also lets you schedule shoots into your photographers' quiet weekday mornings, which is capacity you'd otherwise waste.

You've said no for now and that's a fine call for launch — it's a different sales motion (outbound B2B, not app installs). Worth revisiting once Surat is running, especially given you already have furniture and interior brand relationships. Nothing in the architecture blocks adding it later.

---

## 11. Contractor classification — what this actually means (G-44)

You asked, so plainly:

Indian labour law doesn't care what your contract *calls* someone. It looks at how much you **control** them. If a labour authority or the Income Tax department decides your photographers are really employees, Clickco becomes liable for **PF (12%), ESI, gratuity, paid leave, notice periods — retrospectively**, plus penalties. On 200 photographers that's a business-ending bill.

Since you're the seller of record (not a marketplace), your control looks higher by default, so this needs conscious management.

**Things that make them look like employees — avoid:**
- Requiring exclusivity ("you may not shoot for anyone else")
- Fixed mandatory shifts or minimum hours
- Providing the camera gear *(you're safe — they own it)*
- Clickco-branded uniforms as a requirement
- Punishing job refusals harshly
- Paying a fixed monthly salary regardless of jobs done
- Directing *how* they shoot, minute to minute

**Things that keep them contractors — do:**
- Written **vendor services agreement**, renewed annually, per-job engagement
- They may work for anyone else, including competitors
- They may **decline** jobs (track acceptance rate for ranking, but declining is allowed)
- They **own their equipment** ✅
- They raise an invoice; you pay against it
- Payment is per-job output, not per-hour-present
- You specify the *deliverable* (600 frames, RAW, by T+48h), not the *method*
- No PF/ESI deductions; TDS deducted under 194C/194J
- Their contract explicitly states independent contractor status and no employment relationship

Get the vendor agreement drafted by a lawyer once, use it 200 times. Cost: ₹15–25k. It's the cheapest insurance in this entire build.

---

## 12. GST — the one thing I'd push back on

You marked G-36 "no need for this." As a **marketplace** that would have been arguable. As the **seller of record**, it isn't.

- You invoice the client for the full booking value, so **18% GST is your output liability** on the whole amount (photography/videography, SAC 998383) — not on a commission slice.
- GST registration becomes mandatory once aggregate turnover crosses **₹20 lakh**. At even 15 bookings/day you cross that inside two months.
- **This changes your pricing by 18%.** If your rate card says ₹6,000 for a 2-hour Basic shoot, either the client pays ₹7,080 or you absorb ₹1,080 — and ₹1,080 is likely most of your margin on that booking. Decide *now* whether displayed prices are inclusive or exclusive, because it's baked into the pricing engine and the T&C.
- Offsetting benefit: photographers who are GST-registered give you **input tax credit** on their invoices, which materially reduces your net outflow. That's a genuine argument for preferring registered vendors.
- On payouts: TDS under 194C (contractual) or 194J (professional) applies once you cross audit thresholds. Automate the deduction from day one; retro-fixing a year of payouts is a nightmare.

I'm not a CA and this isn't tax advice — but a one-hour consultation before you finalise the rate card will cost a few thousand rupees and could save a lot. It's the single cheapest de-risking available on this project.

---

## 13. Remaining P0/P1 items, as specified

| ID | Item | Implementation |
|---|---|---|
| G-05 | **Drone addon** | Photographer must upload DGCA Remote Pilot Certificate + drone UIN before the drone flag is enabled. Booking flow runs a Digital Sky airspace check on the venue pincode; auto-disable addon in yellow/red zones. Addon priced separately. |
| G-07 | **Quality escalation** | New role: **Quality Manager.** Client flags → ticket → QM reviews files → outcome: (a) reshoot at Clickco cost, (b) free Clickco Edit on affected files, (c) partial credit. Photographer is paid in full regardless (your call), but the incident is logged; 3 escalations → tier review. |
| G-08 | **Third-party booking** | Booking gets `booker_contact` and `subject_contact` as separate fields. Delivery notification goes to whichever is flagged `gallery_recipient`. Both get the check-in notification. |
| G-13 | **Data loss** | Dual-card recording mandatory at Professional/Expert/Signature (contract clause, spot-audited). On total loss: client full refund + photographer full payout — Clickco absorbs ~160% of booking value. Cap this: 2 incidents per photographer per year, then payout is withheld on the third. |
| G-15 | **Geofenced check-in/out** | 150 m radius of venue, timestamped, device GPS + accuracy value recorded. Offline queue with local timestamp preserved. This is your billing proof and chargeback defence — treat it as financial-grade data, immutable once written. |
| G-16 | **Extension** | Photographer taps "Request extension (1 hr)" → client push + WhatsApp with price → approve → new checkout target, charged to balance invoice. Also: photographer can log a **waiting note** (T&C §1.4/5.2) with geo-timestamp, chargeable. |
| G-19 | **Offline Pro app** | Local write-ahead queue (SQLite/MMKV) for check-in, check-out, extension requests, notes. Sync on reconnect with conflict resolution by local timestamp. |
| G-20 | **Travel** | Zone 0 ≤15 km free · Zone 1 15–40 km slab · Zone 2 outstation = actual travel + ₹ overnight allowance. Auto-computed from venue pincode, shown in the quote breakdown before payment. |
| G-21 | **Editor capacity** | Editors only serve the paid Clickco Edit queue, not the 48h path — so capacity planning is far easier. Queue depth alert at >5 days backlog; overflow to contracted freelancers. |
| G-23 | **Photographer retention** | Earnings dashboard (today / week / month / pending payout, with per-job breakdown) · transparent ranking with the actual inputs shown · payout T+3 after delivery · visible tier-progression criteria · two-way reviews · monthly city leaderboard |
| G-28 | **Double-booking** | Redis `SETNX` lock on `photographer:{id}:slot:{ts}` at accept, TTL to cover the booking window ± 90 min buffer. Postgres exclusion constraint on tstzrange as the backstop. |
| G-29 | **Dates** | Store UTC, render IST. Separate `FestivalCalendar` table drives surge — wedding season (Nov–Feb), Diwali, Navratri, regional festivals per city. Seed 24 months. |
| G-30 | **Notifications** | WhatsApp is primary, push secondary, SMS for critical only. **Start WhatsApp template approval now — it takes ~1 week per template.** Minimum set: booking confirmed, photographer assigned, en route, checked in, shoot complete, balance due, delivery ready, RAW expiring in 48h, waitlist launch. Preference centre for non-transactional. |
| G-31 | **App store review** | UGC surface (photos, reviews) → Apple requires content reporting, user blocking, and a published moderation policy. Budget one rejection cycle. Age rating 12+. |
| G-32 | **Bulk download** | JPEG folder is the primary path; RAW split into ≤2 GB sub-folders. Do not promise a single-click all-files zip on Drive — it will fail. |
| G-33 | **Audit log** | Append-only table, no deletes, no updates. Every admin action: actor, action, entity, before/after, IP, timestamp. Especially refunds, payout overrides, price changes, and link revocations. |
| G-34 | **Idempotency** | `Idempotency-Key` header required on every money-mutating endpoint. Unique index. Store request hash + response; replay on duplicate. |
| G-37 | **Licence tiers** | Single price, both uses permitted. But the T&C wording needs fixing — current §8.2 says "permitted commercial use" without defining *permitted*, which is a dispute waiting to happen. Fixed in T&C v2. |
| G-40 | **Model release** | Opt-**in** checkbox at booking, not opt-out. Current §8.3 is opt-out, which is weak for images of identifiable people and children. One checkbox, big trust gain, zero cost. |
| G-41 | **Police verification** | Manual, pre-onboarding, certificate stored against profile with expiry date. Ops dashboard flags certificates older than 24 months. |
| G-42 | **Anti-disintermediation** | Masked calling (Exotel) so numbers are never exposed · non-circumvention clause in the vendor agreement · Drive link issued by Clickco, never by the photographer · photographer app hides client contact details after CLOSED |
| G-45 | **Policy links** | Refund/cancellation policy, T&C, and privacy policy must each be reachable pre-payment in-app and from the website footer. Required by both app stores and the E-Commerce Rules. |

---

## 14. Build order

**Sprint 0 — 1 week, no app code**
Google Workspace Shared Drive + service account · storage adapter interface (Drive today, R2 later) · WhatsApp template submission (starts a ~1 week clock — do it day one) · vendor agreement to a lawyer · CA consultation on GST · T&C v2 finalised · pincode seed data for 3 cities

**Sprint 1–3 — Backend core**
Postgres schema · auth (phone OTP) · pricing rules engine + snapshot · booking state machine · Razorpay (auth/capture + 50/50 split invoicing) · dispatch cascade + Redis locks · audit log · idempotency

**Sprint 4–6 — Pro app + upload**
React Native Pro app · resumable chunked upload · offline queue · geofenced check-in/out · extension flow · earnings dashboard · **web upload portal** (equal priority to the app — 18 GB uploads belong on broadband)

**Sprint 7–9 — Client app**
Browse plans/categories · pincode gate + waitlist · booking + payment · live tracking · balance payment → Drive link · reviews

**Sprint 10–11 — Ops panel**
Booking board · dispatch desk · **SLA breach board** · upload monitor · quota monitor · photographer onboarding + KYC queue · payouts + TDS · refunds · Quality Manager queue · pricing editor

**Sprint 12 — Launch prep**
Marketing site with programmatic city×category pages · app store submission (budget a rejection) · 25 vetted photographers in Surat, 20 in Mumbai, 10 in Vadodara · 10 dry-run bookings on staff before public launch

---

## 15. Still open

1. **Displayed prices — GST inclusive or exclusive?** Blocks the pricing engine.
2. **Rate card numbers** — I have structure but no figures. Base rates per plan × category × city tier.
3. **Clickco Edit pricing** — per 50 photos? Flat per booking? Drives the whole upsell model.
4. **Advance %** — T&C says 50%. Does that hold for emergency bookings, where there's no time to invoice a balance? Recommend 100% upfront for anything under 24h lead time.
5. **Video in scope at launch?** Changes storage, gear requirements, and photographer vetting materially.
6. **Who is the Quality Manager**, and what's their authority ceiling on refunds without escalation?
7. **Jurisdiction city** for T&C §9 — currently a placeholder. Recommend Surat, Gujarat.

---

*Companion document: `clickco-terms-conditions-v2.md` — your T&C rewritten for the app model, with a changelog of every fix.*
