# ADR-0027 — Sprint 11: notifications, calls, reviews, and the loose ends

**Status:** Accepted 31 Oct 2026. Taken on Darshil's behalf and overridable. Darshil's instruction
(30 Oct): start Sprint 11, and make the whole app secure, tested and optimised.
**Sources:** PLAN §2 S11 ("WhatsApp templates wired, FCM, Exotel masked calls, reviews, UGC
reporting/blocking, empty/error states, Wave 3 screens — every lifecycle message fires"); the S11
gate (WhatsApp templates approved, DLT headers approved, Exotel KYC done); v0.2 notification
matrix; T&C; ADR-0024/0025/0026 carry-overs.

## D1 — The gate is not met, so everything goes behind ports
No WhatsApp templates, DLT headers or Exotel KYC exist yet. Every channel is a **port** with a
**console adapter** (development and tests: records what would be sent, like the SMS console)
and a **real adapter** chosen by environment:
- WhatsApp Business Cloud API (Meta);
- MSG91 or Gupshup for DLT SMS;
- Firebase Cloud Messaging (Expo push token → FCM/APNs);
- Exotel masked calls.

Production refuses to boot with a console adapter selected. The real adapters are built to each
provider's documented API and tested against recorded fixtures. They go live once credentials and
approvals exist.

## D2 — One notification pipeline
- Domain events (outbox) → a `notifications` module maps each lifecycle event to a template and
  recipients.
- A **per-recipient channel plan** is applied (WhatsApp first, SMS fallback, push for app users)
  with quiet hours: no marketing, 9 pm–8 am IST.
- Sends run through a BullMQ queue with retries.
- Every send is recorded: template, channel, status and provider id.
- Templates are versioned code constants, with variables validated and **no free text from users**.
  Each mirrors what goes to Meta for approval.
- **Lifecycle coverage:**
  - booking confirmed;
  - photographer assigned (name + masked number);
  - on the way;
  - checked in;
  - extension request to the client;
  - checked out;
  - balance due + reminders;
  - delivered with the link;
  - refund issued;
  - credit issued;
  - ticket acknowledged and resolved;
  - Pro: new offer (push), assignment reminder, payout paid.
- Opt-outs: users can mute non-essential channels. Transactional messages always go.

## D3 — Masked calls (Exotel)
Client and photographer talk through a virtual number bound to the booking. The binding opens at
assignment and ends 2 hours after check-out. Neither side ever sees the other's real number. Calls
are logged with duration only, never recordings.

## D4 — Reviews and UGC safety
- **Reviews:** after delivery the client rates 1–5 with an optional comment. One review per
  booking; it can be edited for 7 days. The rating feeds the photographer's metrics.
- **Reporting:** clients and photographers can report a review, a message or a user. Reports go to
  a moderation queue on the admin panel (QM/support): hide, keep, or warn the user.
- **Blocking:** a client can block a photographer from future dispatch to them.
- **Free text:** length limits; links and phone numbers are stripped from public text.

## D5 — Client entry points and polish (carry-overs)
- **In-app:** raise a support ticket (SA-02), report a quality issue on a delivered booking, and
  see refunds and credits on the booking.
- **Admin booking page:** Refund and Issue credit buttons.
- **Payouts** for undelivered shoots: DATA_LOSS, ACCESS_DENIED, CLIENT_ABSENT, under the
  ADR-0013/0016 rules.
- **Pro app:** earnings show paid payouts with TDS.
- **Empty, error and offline states** reviewed on every screen of the client and Pro apps.

## D6 — Security and performance hardening, before any new feature lands
The whole-app audits of 31 Oct (identity and access, money and files, clients, performance) are
fixed first. Every CRITICAL and HIGH finding is fixed with a regression test. MEDIUM findings are
fixed or recorded here with an owner. Recurring checks go into CI:
- `pnpm audit` (fails on high in production dependencies);
- a secret scan;
- the audited-routes and guard-coverage tests.

Recorded (identity and access audit, L4 — owner: API), **done 2 Nov 2026:** the global per-IP
throttler (`IpThrottlerGuard`, @nestjs/throttler) used to keep its counters in process memory, so
each instance would have allowed the full limit. Its storage is now the shared Redis
(`RedisThrottlerStorage`, `common/http/redis-throttler-storage.ts`, on the REDIS client):
- One Lua script per request does the INCR, the window's PEXPIRE and the block, atomically on every
  instance. It is a fixed window (120 a minute per route and IP bucket): past the limit the caller
  is refused for the block duration (the window, by default) and nothing is counted meanwhile. A
  fixed window can let up to twice the limit through across a window boundary; it is a backstop.
- Keys: `{QUEUE_PREFIX}:throttle:{sha256(throttler name, guard key)}:hits|block`. No address
  lands in Redis, and both keys share one cluster slot.
- **Fails open.** The request is allowed when Redis errors, has not answered within 1 s, or the
  client is already known to be disconnected. A warning is logged at most once a minute per
  process.
  - After a failure, requests skip Redis for 5 s, so an outage neither builds a queue of commands
    in the shared client nor slows every request.
  - The OTP limits (Postgres + Redis) and the staff lockouts (Redis) are separate and enforced on
    their own.
- Now that the limit is shared, it is effectively stricter than before for any route that had more
  than one instance behind it.
- **Accepted LOWs** (security review, 2 Nov):
  - While it fails open, `X-RateLimit-Remaining` shows the full limit.
  - `EVAL` sends the script on every request.
  - Rotating IPv6 /64s, which already get past a per-/64 limit, also add keys. Each expires within
    a window. A coarser /48 limit is a launch-checklist item.

### D6a — Money and files audit (31 Oct 2026): what was done
Each item has a regression test. Migration/addendum **0012** carries the schema side.

- **H1 — untrusted RAW files.** darktable now runs in a separate **media worker** (`src/worker.ts`,
  `pnpm --filter @clickco/api start:worker`) that loads only the media-export processor and its
  module (no payments, dispatch, auth or admin code). With `MEDIA_WORKER_ISOLATED=true` the API
  process neither consumes the `media-export` queue nor registers the processor; staging and
  production refuse `JPEG_EXPORT_ADAPTER=darktable` without it. In code: a RAW above the largest
  accepted photo is refused before download and again before darktable runs; on Linux darktable
  runs under `ulimit -v` (6 GB), refusing to start if the cap cannot be set; it keeps the stripped
  environment, the file-signature check and the 120 s timeout. The container hardening the worker
  needs is in apps/api/CLAUDE.md ("Media worker"); it is a launch-checklist item (S12, replaces
  ADR-0015 "H3 isolation").
- **H2 — payouts could pay twice.** Export, bank file, mark paid, mark failed and send again each
  need a fresh authenticator code. Marking a transfer failed needs the bank's return reference.
  Mark failed and send again are **maker–checker**: never the person who created the bank file the
  transfer went out in (checked before the code is spent, and again in the transaction). A resend
  within 7 days of the original file raises a HIGH `ops.alert` (`payout.early_resend`). Each
  transfer records who made its bank file and when (the first file's time survives resends).
- **Refunds and credits.** Approving a refund that takes the booking above the QM ceiling needs
  the approver's fresh code (the refund item says so: `needsAuthenticatorCode`). **L8:** a credit
  above ₹5,000 (`MONEY_DESK_CONFIG.creditFourEyesPaise`, from `CREDIT_FOUR_EYES_PAISE`) is
  four-eyes in one request: the issuer's code and a second FINANCE/SUPER_ADMIN's sign-in email and
  own code; the audit row names the co-approver. Same rule when settling a review item with a credit.
- **M1.** No grants beyond migration 0011 were needed: 0012 only adds columns, one table
  (`payment_webhook_rejections`, a mutable counter, not append-only) and constraints.
- **M2 — KYC documents.** The API never returns a provider URL. `view-link` returns an opaque,
  single-use path `GET /admin/supply/kyc/view/<token>` (only its sha256 is kept, in Redis, 5
  minutes, bound to the staff member who asked, consumed atomically with GETDEL). The route sits
  behind StaffGuard, streams the bytes from StoragePort with `no-store`, `nosniff` and a sandbox
  CSP, and audits every open (`kyc.document_opened`). The panel fetches the bytes with the staff
  session and opens them from an object URL (only `blob:` of its own origin is followed).
- **M3 — payment webhooks.** The webhook route skips the global per-IP throttle (a gateway retry
  burst must never be dropped); bad signatures are limited per caller IP in Redis (10 per 15
  minutes, IP hashed), after which that IP's unverified requests are 429 before anything is stored.
  Valid signatures are never limited. A bad signature is counted per provider per UTC hour
  (`payment_webhook_rejections`, with a sample body hash), not stored as a row each.
- **M4 — bank account numbers.** Their own `BANK_ACCOUNT_KEY` (32 bytes), required when deployed,
  never equal to STAFF_TOTP_KEY. The sealed value starts with a key-version byte; rotation =
  `BANK_ACCOUNT_KEY_VERSION` up, old key in `BANK_ACCOUNT_KEY_PREVIOUS` (opens only) until a re-seal.
  The STAFF_TOTP_KEY-derived key (version 1) remains for development data only.
- **M5 — delivery links: stream through Clickco.** Chosen over per-recipient Drive permissions:
  clients do not all have Google accounts, a Drive permission outlives a forwarded link's owner,
  and Drive has no expiring links of its own (ADR-0026). `/d/<token>` never redirects; it lists the
  link's files (`DeliveryFolderView`), and `/d/<token>/files/<id>` streams each file from
  StoragePort as an attachment (`no-store`, `nosniff`, sandbox CSP). **Deferred:** HTTP Range
  (StoragePort.openObject has no ranged read; resumable downloads of large RAW files wait for it),
  and the client-facing page that renders the listing (done 2 Nov 2026: D6c).
  Bandwidth through the API is the accepted cost; revisit at launch volume.
- **L1.** A verified webhook keeps only the fields Clickco parsed (ids, amount, kind) and the sha256
  of the exact body; payer email, contact and VPA are never stored. Existing payloads are reduced
  to their event type by 0012.
- **L2.** Delivery-link tokens are derived (HMAC-SHA256 under `DELIVERY_LINK_KEY`, required when
  deployed) and only their sha256 is stored; existing rows were backfilled and their tokens cleared.
- **L3.** A BullMQ repeatable job (`checkout.stale-advance-sweep`, every 5 minutes) cancels
  ADVANCE_PENDING bookings whose payment window closed (quote expiry + 30 min grace, or the start
  passed): ADVANCE_PENDING → CANCELLED_CLIENT by SYSTEM, reason `PAYMENT_WINDOW_EXPIRED`, which
  frees the promo redemption. DOMAIN §2 lists this transition for USER only; this ADR adds the
  SYSTEM actor for an unpaid quote (no money has moved; a late capture takes the existing
  "captured on a cancelled booking" review path).
- **L4.** No public sandbox webhook secret: `SANDBOX_WEBHOOK_SECRET` (32+ characters, never the old
  published string) is required with the sandbox in development; tests get a random one.
- **L5.** The authorise-only hold lease is 90 s (a release makes up to three 10 s gateway calls).
- **L6.** Paying plans the order under the booking lock, creates the gateway order with no
  transaction open, then records it under the lock after re-planning (a concurrent winner's order
  is returned; a changed amount is 409 `BOOKING_CHANGED`).
- **L7.** A UTR identifies one transfer: two exclusion constraints on `payouts` (same UTR ⇒ same
  batch and same photographer) plus the service check.
- **L9.** A refund webhook whose relay fails is marked failed like any other webhook, so the
  gateway's retry processes it again.

### D6b — Performance audit (31 Oct 2026): what was done
- **Database:** migration/addendum **0014** adds seven indexes, each for a named read (alert feed,
  booking board, payout UTRs, incident reports, board search, open dispatch rounds). The pool size,
  idle close, `statement_timeout` (5 s) and `idle_in_transaction_session_timeout` (30 s) come from
  env (`DB_POOL_MAX`, `DB_IDLE_TIMEOUT_S`, `DB_STATEMENT_TIMEOUT_MS`,
  `DB_IDLE_IN_TRANSACTION_TIMEOUT_MS`). A job that needs longer sets `SET LOCAL statement_timeout`
  in its own transaction.
- **Outbox:** a tick claims up to 100 events with a 10-minute lease and commits, delivers outside any
  transaction, then settles each event on its own. Delivery stays at-least-once.
- **API:** the Today overview is cached per grant set in Redis for 20 s (an incomplete answer is
  never cached). The UTR check reads a whole mark-paid request in one query. At most 2 scrypt runs
  at once; 32 more may wait, and the rest get 503.
- **Apps:** polling backs off (Pro offers, portal). Per-second clocks are their own components. The
  client draft is debounced. Admin lists fetch at most 3 pages. Pro polls only while focused. Web
  photos and reels are cached for a day (their names carry no content hash).
- **CI** (`.github/workflows/ci.yml`): biome, typecheck, every test suite (the API with
  `--maxWorkers=2`), `pnpm audit --prod --audit-level high`, and gitleaks on each push or PR.
  Actions are pinned to commit SHAs, and checkouts don't keep the token.
- **Accepted advisory:** GHSA-mrhx-c7xc-m3w5 (zod < 4.6.6) affects only the zod 3.25.x inside
  `@expo/cli`, which is build tooling and is never fed untrusted input. No patched 3.x exists, and
  Clickco's own zod is 4.6.7. It is ignored in `pnpm-workspace.yaml`. Review at each Expo SDK bump.
- **Recorded LOWs (owner: API, before S12 launch):**
  - **Done 2 Nov 2026:** each outbox delivery has a time limit under the lease, and a claim token
    that the settle updates must match.
    - One event's delivery (its subscribers, in order) may run 2 minutes (`DELIVERY_TIMEOUT_MS`).
      A tick starts none after 5 minutes, so its last one settles inside the 10-minute lease.
    - Past the limit, the subscriber still running is recorded as failed (`DeliveryTimeout`).
      Later subscribers wait for the retry. Each handler gets an AbortSignal, aborted at the limit.
    - JavaScript cannot stop a handler that ignores the signal. So the tick keeps its claim (token
      and a fresh lease) until that handler returns, then hands the event back on its backoff.
    - A handler that never returns loses the claim when the lease ends. Either way, no second copy
      starts while the first is known to be running.
    - Addendum/migration **0018** adds `domain_events.claim_token`, a random uuid written with each
      claim. Marking an event published, recording a failure and handing a claim back all match
      the token and clear it. A tick that outlived its lease, once another tick has claimed the
      event, changes nothing. clickco_app gets UPDATE on the new column only.
    - During a rolling deploy, old instances neither write nor check the token. The guarantee holds
      once they are gone.
    - Not yet:
      - No subscriber passes the signal on to its own I/O.
      - If a settle query itself throws, the tick's unstarted claims wait out the lease instead of
        being handed back (LOW).
  - Replace `script-src 'unsafe-inline'` on the web CSP with build hashes. Start with `/d/(.*)`
    (one fixed page, and the one whose address carries a delivery token, D6c).
  - Run one full-history gitleaks scan of the public repo.

### D6c — The delivery page lives on the website (2 Nov 2026)
**Decision:** the page clients open from the DELIVERED message is on the marketing site (apps/web),
not in the client app and not served by the API. It works without the app installed, on any
phone browser, and the API keeps serving JSON and file bytes only.
- **Link.** Messages link to `<PUBLIC_WEB_URL>/d/<token>`. The `/d/<token>` path and the token are
  unchanged. `PUBLIC_WEB_URL` (apps/api env.ts) is an origin: https and required in staging and
  production, required with a real WhatsApp or SMS adapter, `http://localhost:3000` (the web dev
  server) otherwise. The WhatsApp template's URL button (`photos_delivered_v1`) must be
  registered with the base `<PUBLIC_WEB_URL>/d/`.
- **Page.** The static export builds one page, `out/d/index.html`. vercel.json rewrites
  `/d/:token` (with or without the trailing slash) to it, so the address bar keeps the token.
  - The browser reads the token from its own path and checks it like the API does (43 base64url
    characters). A malformed one shows "incomplete link" and nothing is fetched.
  - It reads `GET <NEXT_PUBLIC_API_URL>/d/<token>` with no cache, no cookies, no Referer and no
    redirects, and shows nothing the `DeliveryFolderView` schema rejects.
  - States: the file list, expired (410), not found (404 `LINK_NOT_FOUND`), incomplete link, and
    a retryable error (anything else, including a timeout).
  - Each download is a plain link to the API's `/d/<token>/files/<id>`, built from the token and
    the file's uuid. The API streams it as an attachment, as before.
  - The listing now names the booking reference (`bookingReference`), the same one the DELIVERED
    message shows beside the link. Nothing else about the booking is listed.
- **Headers** (vercel.json, `/d/(.*)`): `Cache-Control: no-store`, `Referrer-Policy: no-referrer`
  (overrides the site's `strict-origin-when-cross-origin`), `X-Robots-Tag: noindex, nofollow`. The
  page also carries `<meta name="referrer" content="no-referrer">` and a robots noindex meta. The
  site CSP already allows `connect-src` to the API origin only, and next.config.ts fails a deploy
  build whose `NEXT_PUBLIC_API_URL` the CSP would block.
- **Who sees the token.** The site loads no analytics or third-party script (CSP `script-src` has
  no origin but the site's own; `'unsafe-inline'` remains, see D6b), fonts are self-hosted, and the
  page's code sends the token to the Clickco API only. The HTML is the same for every token, so a
  link preview (WhatsApp, SMS apps) sees no files.
  - **Accepted (security review MEDIUM, 2 Nov):** the token is in the page's address, so the site's
    host, Vercel, records it in its request logs, as the API's host records API requests. Anyone
    who can read those logs could open the link until it expires. Launch-checklist items (owner:
    Darshil): limit Vercel log access on the team to the people who run the site, and keep `/d/*`
    out of any log drain.
  - The alternative is `/d/#<token>`: a fragment never reaches a server. It changes this decision's
    URL and needs Meta to accept a URL-button base ending in `#`, so it stays an owner decision.
- **CORS** (apps/api http-app.ts). `CORS_ORIGINS` applies to every route, as before. The
  `PUBLIC_WEB_URL` origin is admitted only on `GET`/`HEAD` of `/d/<token>` (a well-formed token),
  and on its preflight, with methods `GET` and never credentials. Downloads are navigations and
  need no CORS. This is narrower than adding the website to `CORS_ORIGINS`, which would let it
  read every route.
- **Not yet:**
  - A "download all": the API has no archive route, so each file is one tap.
  - Ranged downloads (D6a M5).
  - Downloads count against the listing's 60 a minute per IP (`linkHitsPerMinutePerIp`). A
    client saving more than about 59 files in a minute, or many clients behind one carrier NAT,
    get a 429, and the tab then shows the API's JSON. A separate, higher limit for
    `/d/:token/files/:id` is an API follow-up (security review LOW).
  - The booking reference proves nothing about who someone is: support must not treat it as
    identity (security review LOW; runbook item).

### D2/D3a — Notifications and masked calls as built (1 Nov 2026)
- Client messages go to the account's verified phone, not the booker phone typed into a booking.
- The link in messages was `PUBLIC_API_URL/d/<token>`, which returned the JSON file list. Since
  D6c (2 Nov 2026) it is `PUBLIC_WEB_URL/d/<token>`, the web delivery page.
- Ticket acknowledged/resolved and the Pro assignment reminder have no domain event yet, so they
  have no template either. They wait for those events. (2 Nov: a raised ticket now has one;
  see D5a.)
- Masked calls are their own `CallsModule`. A binding opens only for the booking's current
  assignment. An access-denied or unsafe-site ending closes it 2 h later, like a check-out. Calls
  are reserved under a lock before the provider is asked, with per-window and per-day caps.
- 0015 supersedes the spec's `notification_log` and `masked_call_log` (full addresses; a
  recording key) and makes them read-only to the app role.
- **Deferred:** Expo push receipt checks; the call buttons in the client and Pro apps; device
  registration in the apps (needs `expo-notifications`, awaiting the owner).

### D4a — Reviews and UGC safety as built (1 Nov 2026)
- `reviews.photographer_id` (0016) records who was reviewed. A re-dispatch never moves a rating.
  The rating is recomputed from published CLIENT_TO_PRO reviews by the photographers module's own
  subscriber.
- Editing a review is refused while a report on it is open, and once staff have kept it. A report
  on a review keeps a copy of the rating and comment it was filed against.
- **Blocking:** dispatch never offers a blocked photographer the client's bookings. Open offers
  are withdrawn when the block lands (`dispatch.offer_withdrawn`, reason CLIENT_BLOCKED), and a
  late accept is refused under the booking lock. An existing assignment is not touched; the
  client cancels or contacts support.
- **Public text:** after NFKC and digit folding, links, emails and phone numbers are stripped,
  including spaced, "dot" and "[.]" forms. "name. com" and "name dot in" are left alone, because
  stripping them would also catch ordinary sentences.
- **Deferred:** reporting a message (there is no in-app messaging yet); notifying the person on
  WARN; unhide; PRO_TO_CLIENT reviews and the sub-scores; the client and Pro app screens.

### D5a — Client entry points and payouts as built (2 Nov 2026)
- **Payouts for undelivered shoots** go through the same `payouts` row, weekly batch, TDS and
  ledger as a delivered one. `payouts.basis` and `basis_bps` (addendum/migration **0017**) say
  why. Each falls due 3 days after its outcome. Amounts are named constants in
  `payouts/rules/outcome-payouts.ts`. Each one the owner may override:
  - **DATA_LOSS** pays the full payout, extension and waiting shares included (DOMAIN §2,
    v0.2 G-13).
    - A partial loss pays the same. G-13 names only a total loss, but a partial loss cannot pay
      less than a complete one.
    - The cap is 2 losses per photographer in any 365 days. From the third, the payout is written
      WITHHELD with its reason, and ops is alerted on the booking.
    - Finance can release a withheld payout from the payouts desk ("Held back"). Releasing it
      needs a fresh authenticator code and a note, and it is audited (`payout.release`).
  - **ACCESS_DENIED** pays half the payout: the photographer's share of the 50 % the client is
    charged (T&C §7.2). Travel still passes through at 100 % (doc 05 step 12).
  - **CLIENT_ABSENT** pays the booked payout without the waiting share. The waiting charge is
    waived (ADR-0016 D12), and the CLIENT_NON_ATTENDANCE review now suggests charging the balance
    less that waiting charge.
    - The photographer reports the absence themselves, so the payout accrues only when staff
      settle that review (`review.settled`). It falls due 3 days after the check-out.
  - When an outcome event cannot accrue a payout, a HIGH `payout.not_accrued` ops alert is
    raised, instead of the payout silently going missing.
  - No route reaches DATA_LOSS yet. Payouts subscribe to `booking.data_loss` for when one does.
- **Pro earnings:**
  - A job pays its payout's gross once one is accrued (0 while withheld), and each job carries
    its payout status and basis.
  - Access-denied shoots count in the period totals by the day they ended.
  - Pending leaves out paid and withheld payouts.
  - Paid transfers are listed with batch reference, paid date, gross, deductions, TDS, net and the
    UTR's last 4 characters. They come from the payouts module's `ProPayoutsReader`.
- **Client:**
  - `GET /bookings/:id/money` shows refunds once approved (PROCESSING or REFUNDED) and credits
    (amount, remaining, expiry).
  - `POST/GET /me/tickets`: a category and 10–2,000 characters; at most 5 a day per client;
    idempotent. The subject and contact details come from the account and the booking.
  - `POST /bookings/:id/quality-issue`: the client's own DELIVERED booking, within 30 days of
    delivery, once per booking. The actor is USER, and the request is idempotent.
  - Client writes are limited to 10 a minute per IP.
- **Admin booking page:**
  - Refund sheet: the request is made here and another person approves it.
  - Issue credit sheet: above ₹5,000 it needs two people. If the response is lost, the identical
    request is resent with the same key, so a credit is never issued twice.
  - Both appear only for the roles and cities the API accepts.
  - The ticket Resolve dialog now says the client reads the summary in the app.
- **Notifications (2 Nov 2026):** three more versioned templates, all transactional, on WhatsApp,
  SMS and push. Their variables are strict, and none is free text:
  - `ticket.raised` → **TICKET_RECEIVED** to the client: the ticket reference and a reply-by time,
    which is the ticket's own acknowledgement deadline (48 h).
  - `payout.withheld` → **PRO_PAYOUT_ON_HOLD** to the photographer: the gross and the shoot date.
  - `payout.released` → **PRO_PAYOUT_RELEASED** to the photographer: the gross and the shoot date.
  - Never in a message: the withheld reason (staff-written), who released it, or the client's words.
  - Still missing: **TICKET_RESOLVED** (`TicketsService.resolve` emits no event), a message when
    staff acknowledge a ticket (no event either), and the Pro assignment reminder.
- **Not done here:**
  - Tickets raised without a booking are visible only to all-city support.
  - A refund that failed and was then abandoned still shows the client "processing".
  - The co-approver check returns different errors for finance and non-finance emails, which lets
    someone work out who is finance (existing code).
  - No payout rule exists yet for ABANDONED bookings: the shoot happened, but the balance was
    never paid.
