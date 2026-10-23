# ADR-0014 — Sprint 7 design: media pipeline + photographer upload portal

**Status:** Accepted 23 Oct 2026 (taken on Darshil's behalf; overridable)
**Sources:** doc 02 §1, §6 (StoragePort, Drive requirements), §7 (portal requirements); v0.2 §3 (RAW → JPEG),
§4 (pipeline, Drive non-negotiables), §5 (tripwire); DOMAIN §2 (CHECKED_OUT → UPLOADING → PROCESSING → QA,
DATA_LOSS), §4 (SLA ladder), Invariants 6, 7, 24, 25; ADR-0001 (Drive), ADR-0004 (portal primary),
ADR-0005 OD-11 (photos only at launch), ADR-0008 (hosting); schema §9 (upload_sessions, media_assets,
media_integrity_audits, storage_quota_samples), §13 (feature_flags). **No schema change**: everything below
fits the spec tables.

## D1 · StoragePort — doc 02 §6 plus the methods multipart needs
`infra/storage/storage.port.ts` keeps the doc's eight methods and adds four. Nothing outside
`infra/storage/` knows which adapter is live; no storage SDK is imported outside `infra/storage/adapters/`.

| Method | Notes |
|---|---|
| `createUploadSession({bookingId, bookingRef, yearMonth, relativePath, sizeBytes, contentType, kind, partSizeBytes})` | One adapter session **per file** (Drive resumable sessions are per file). Returns `{sessionId, uploadUrl, expiresAt}`. `uploadUrl` is internal (never sent to a browser). |
| **`uploadPart(sessionId, partNumber, body, {sizeBytes, sha256, md5?})`** | Added. Streams one part; the adapter hashes while writing and commits only if size and hash match (`PartChecksumMismatchError` / `PartSizeMismatchError`, nothing kept). Re-putting a part replaces it atomically. |
| **`listParts(sessionId)`** | Added. Parts the adapter holds (resume + reconciliation). |
| `completeUpload(sessionId, checksum)` | `checksum` = expected **SHA-256 hex of the whole file**. The adapter assembles parts in order, computing SHA-256 and MD5 in one pass; mismatch ⇒ `ChecksumMismatchError` and **all part data is discarded**. Returns `StoredObject` (MD5 = the provider-side checksum stored in `media_assets.checksum_md5`). |
| `abortUpload(sessionId)` | Idempotent. |
| **`putObject(input, body)`** | Added. Single-shot write for server-produced files (exported JPEGs, later proof shots). |
| **`openObject(objectId)`** | Added. Read stream — the JPEG export worker and audits need the bytes. |
| `createDeliveryLink` / `revokeDeliveryLink` | Contract only in S7; S8 issues links (Invariant 9). |
| `permanentlyDelete(objectIds)` | **Never trash** (Invariant 6). Missing ids are ignored (idempotent). |
| `getUsage()` | `{usedBytes, limitBytes, dailyUploadedBytes, dailyLimitBytes \| null}`. |
| `listObjects(bookingId)` | Everything the provider holds for the booking (integrity audit). |

Folder layout (logical `path`, identical for every adapter): `Clickco/{YYYY-MM}/{booking_ref}/{Photos-JPEG |
Photos-RAW/part-NN | Video}/{file}`. `YYYY-MM` is the booking's scheduled start month in IST. RAW files are
packed into `part-NN` folders of ≤ 2 GiB (`planRawFolders`, a pure function; later sessions continue filling
the booking's last folder). Object ids are adapter-generated and unique (a re-upload never collides with a purged
row in `media_assets_object_uq`).

**Rolling 24 h upload bytes** (`UploadBudget`, Redis hourly buckets `…:storage:uploaded:{adapter}:{hour}`, 25 h
TTL, sum of the last 24) is recorded by the adapters on every completed write and read by `getUsage()`.
`MediaService` refuses a new upload session (503 `STORAGE_DAILY_CEILING`, + `ops.alert`) when today's bytes plus
the session's declared bytes would pass **85 %** of the daily limit, and (503 `STORAGE_FULL`) when the declared
bytes do not fit in the remaining storage.

### Adapters
- **LocalDiskAdapter** (dev/test). Root `STORAGE_LOCAL_ROOT` (default `./.storage`, gitignored; `test` defaults
  to the OS temp dir). Layout: `sessions/{id}/part-NNNNN` (+ meta), `objects/{id}` + `{id}.json`,
  `index/{bookingId}/{id}`, `links/{id}.json`. Temp-file + rename for every commit. `permanentlyDelete` really
  unlinks. Limit `STORAGE_LOCAL_LIMIT_BYTES` (default 50 GiB); daily limit `STORAGE_DAILY_UPLOAD_LIMIT_BYTES`
  (unset = no ceiling locally).
- **GoogleDriveAdapter** — typed skeleton: every method throws `StorageNotConfiguredError` until the Shared Drive
  + service account exist (**PLAN B10, the S7 gate**). No `googleapis` dependency yet. When implemented it must:
  stage parts on the API volume (Drive resumable uploads are sequential, so out-of-order parallel parts cannot be
  forwarded live); push the assembled file through a **BullMQ queue** (one rate-limited `drive` queue,
  exponential backoff on `403 rateLimitExceeded`/`userRateLimitExceeded` and `429`, honouring `Retry-After`);
  compare its local MD5 with Drive's `md5Checksum` (mismatch ⇒ re-upload, never complete); delete with
  `files.delete` (`supportsAllDrives`), **never** `files.update{trashed:true}`; record bytes in `UploadBudget`
  with a 750 GB/day default limit; write into the Shared Drive only (service-account owned, never a personal
  Drive); create the folder tree above with RAW sub-folders ≤ 2 GB; serve `openObject` from the staging cache when
  the object is still there. The same contract suite (`storage-port.contract.ts`) that LocalDisk passes is the
  acceptance test for it.
- Env `STORAGE_ADAPTER` `local | drive` (default `local`); `local` is refused in staging and production, so a
  deployed API must say `drive` (and will answer 503 `STORAGE_NOT_CONFIGURED` until B10 lands).

## D2 · Upload sessions (web portal)
- `POST /pro/bookings/:bookingId/upload-sessions` (`@Idempotent`): the caller's assignment for the booking must be
  `ACTIVE` or `COMPLETED` (read through the dispatch module's public `AssignmentReads`) and the booking
  `CHECKED_OUT` or `UPLOADING`; otherwise 404 (not theirs — existence never leaks) or 409
  `BOOKING_NOT_UPLOADABLE`. The first session moves the booking **CHECKED_OUT → UPLOADING** in the same
  transaction (`booking.uploading`). **One active session per booking** (`OPEN`/`UPLOADING`): another create is
  409 `UPLOAD_SESSION_ACTIVE` with the existing id (the portal resumes it). `origin = WEB_PORTAL`.
- Manifest validation (shared constants in `@clickco/contracts` `MEDIA_LIMITS`): RAW `.cr2 .cr3 .nef .arw .raf
  .orf .rw2 .dng`, JPEG `.jpg .jpeg`, VIDEO `.mp4 .mov .m4v .mts` **only when feature flag `video_uploads` is on**
  (`is_enabled` and the booking's city in `enabled_cities` when set; `rollout_bps` unused for this flag) —
  otherwise 422 `VIDEO_UPLOADS_DISABLED` (OD-11). `kind` must match the extension. Photo ≤ 200 MiB, video
  ≤ 8 GiB, ≤ 3,000 files and ≤ 200 GiB per session, names ≤ 200 chars without path separators or control
  characters, no duplicate names (case-insensitive) in one session, `clientFileId` `[A-Za-z0-9_-]{1,64}` unique.
- **Frames.** `declaredFrameCount` must equal the frames in the manifest — distinct case-insensitive file stems
  among photos, so a RAW+JPEG pair is one frame — else 422 `FRAME_COUNT_MISMATCH` with both numbers (the portal
  pre-fills the detected count and makes the photographer confirm it).
- **Parts.** The server dictates the part size: **8 MiB** (doc 02 §7 allows 8–16). Parts `1..N`; every part but
  the last is exactly the part size. `PUT …/files/:fileId/parts/:n` takes a raw `application/octet-stream` body
  (streamed, never buffered; ≤ 16 MiB is enforced on that route only — JSON limits elsewhere are unchanged),
  `Content-Length` must equal the planned size, and `X-Part-Sha256` (hex) and/or `Content-MD5` (base64) are
  verified before the part is kept (422 `PART_CHECKSUM_MISMATCH`). The same part with the same SHA-256 again is a
  no-op 200 (`alreadyStored: true`); a different body replaces it until the file is verified; after that it is 409
  `FILE_ALREADY_VERIFIED`. Part PUTs carry no Idempotency-Key — the part number is the key. The parts route is
  throttled at 1,200/min per IP (the global 120/min would stall a 600-file card).
- **Resume state** lives in `upload_sessions.completed_parts` (the spec's jsonb):
  `{v, partSizeBytes, declaredFrameCount, files: {clientFileId: {name, kind, sizeBytes, lastModified, partCount,
  folder, storageSessionId, parts: {n: sha256}, status: PENDING|VERIFIED, sha256, assetId}}}`. Each part is one
  `jsonb_set` UPDATE under the row lock (atomic under concurrency). Known cost: the document is rewritten per
  part; acceptable at launch volumes — move parts to an addendum table if it shows in profiles. `GET
  /pro/upload-sessions/:id` returns it (parts as numbers + hashes). No DB connection is held while bytes stream.
- **File complete** `POST …/files/:fileId/complete {sha256}` (`@Idempotent`): all parts present ⇒ adapter
  assembly + whole-file SHA-256 check. Mismatch ⇒ 422 `CHECKSUM_MISMATCH`, the file's parts are discarded and it
  restarts from part 1. Success ⇒ one `media_assets` row (`checksum_md5` = provider MD5, `checksum_verified_at`
  = now, **`purge_after` NULL** — S8 sets it from `delivered_at`, Invariant 7), `received_file_count/bytes` += 1.
- **Session complete** `POST /pro/upload-sessions/:id/complete` (`@Idempotent`): every manifest file verified
  (else 409 `UPLOAD_INCOMPLETE` with the missing ids) and declared = received (count and bytes) = asset rows ⇒
  `COMPLETED` and **UPLOADING → PROCESSING** (actor SYSTEM, "Upload verified complete") in one transaction. A
  reconciliation mismatch marks the session `FAILED` and raises `ops.alert` (a code bug, never a photographer
  error). `VERIFYING` is not used in S7.
- **Abort** `POST /pro/upload-sessions/:id/abort` (`@Idempotent`): `ABORTED`; unfinished adapter sessions aborted;
  objects already verified in that session permanently deleted and their rows marked `purged_at`. The booking stays
  UPLOADING (there is no way back to CHECKED_OUT) and a new session may start.
- `GET /pro/upload-jobs`: the photographer's ACTIVE/COMPLETED assignments whose booking is CHECKED_OUT, UPLOADING,
  PROCESSING or QA, with `checkedOutAt` (the booking's CHECKED_OUT transition, i.e. T0) and
  **`uploadDeadlineAt = T0 + 6 h`** (ADR-0004, photographer-facing). The SLA ladder's UPLOAD_START (+2 h) and
  UPLOAD_COMPLETE (+12 h) remain internal ops signals armed by S8; S7 builds no clock.

## D3 · Checksums end to end
The portal computes **SHA-256 per part** (WebCrypto) and **SHA-256 per file** with a small streaming SHA-256 in
TypeScript (WebCrypto has no incremental digest), fed with the parts in order as they are read — on resume the
already-uploaded parts are re-read and hashed locally, never re-sent. The server verifies every part on arrival and
the whole file while assembling; the adapter verifies the provider's MD5. The client never needs MD5.

## D4 · JPEG export (`jpeg-export` job)
- The media module subscribes to `booking.processing` and enqueues `media.jpeg-export` (jobId
  `jpeg-export-{bookingId}`; at-least-once, idempotent). The job exports every verified RAW without a derived JPEG
  (`derived_from_asset_id`), in batches, then moves **PROCESSING → QA** (`booking.qa`, actor SYSTEM). Uploaded
  JPEGs are delivery JPEGs as-is (no row added). Which JPEGs form the client folder when a frame has both is S8's
  delivery decision.
- `JpegExportPort` adapters, env `JPEG_EXPORT_ADAPTER` `darktable | passthrough` (default `passthrough` in
  development/test, `darktable` elsewhere; **passthrough refused in staging/production**):
  - **DarktableCliAdapter** — spawns `DARKTABLE_CLI_PATH` (default `darktable-cli`) with an argument array (no
    shell), neutral output (`--apply-custom-presets false`, `--hq true`, JPEG quality 92, `--library :memory:`,
    throwaway `--configdir`), 120 s per file. **Deployment:** the worker image must carry darktable ≥ 4.6
    (ADR-0008); a missing binary fails the job with a clear error and BullMQ retries.
  - **DevPassthroughAdapter** — never decodes RAW; writes a tiny valid 1×1 JPEG whose COM segment says
    "dev passthrough — RAW export pending". Its row is flagged: `original_filename` `{stem}.export-pending.jpg`,
    1×1 px. Never available in staging/production.
- A file that fails export fails the job (retries 5×, 30 s exponential); the final failure raises `ops.alert` and
  leaves the booking in PROCESSING for staff (DATA_LOSS is a STAFF decision, DOMAIN §2).

## D5 · Integrity audit and quota monitor
- `media.integrity-audit`, repeatable **weekly**: for every booking with a COMPLETED session and unpurged assets,
  `expected` = Σ declared files of completed sessions − purged originals; `db` = verified unpurged originals;
  `provider` = `listObjects` count; set comparison of ids, sizes and MD5s against all unpurged rows. One
  `media_integrity_audits` row per booking (`OK | MISMATCH | PROVIDER_ERROR`, bounded `detail`); non-OK ⇒
  `ops.alert` (HIGH).
- `media.quota-monitor`, repeatable **every 15 min**: `getUsage()` → `storage_quota_samples`. `ops.alert` when a
  sample crosses **60 / 75 / 90 %** of storage (MEDIUM / HIGH / CRITICAL) or 85 % of the daily upload ceiling
  (HIGH) — on the crossing only (compared with the previous sample), so ops are not paged every 15 minutes.
- Alerts are `ops.alert` domain events written by media with a dedupe key (the existing pattern).

## D6 · Portal (`apps/portal`, Next.js App Router, port 3002)
Token CSS like the console (shadcn arrives with `@clickco/ui-web` in S9). Its transport is a thin typed fetch
layer over `@clickco/contracts` + `@clickco/api-client`'s envelope/`ApiError` helpers — the shared SDK is
JSON-only and has no photographer routes; binary part PUTs move into it when its owner next touches it. Tokens
live in `sessionStorage` (tab-scoped; refreshed through `/pro/auth/refresh`); upload checkpoints live in
IndexedDB keyed by photographer + session, so closing the tab loses the sign-in but not the upload: sign in, drop
the same card folder, Resume (files matched by name + size + last-modified; the server's part list wins).
Uploader: 8 MiB parts, 4 in flight, retry on network errors / 5xx / 429 after 1, 2, 4, 8, 16 s then surface;
progress counts **acknowledged** bytes only, ETA from a 30 s moving rate; cancel aborts in-flight requests and the
session. Folder drop walks directories; unknown extensions, oversize files and duplicates are listed with reasons.
The uploader is pure TypeScript with injected transport/checkpoints/hash/clock and is unit-tested without a browser.

## Deferred
S8: delivery links, `purge_after`, RAW/JPEG purge, SLA clocks, QA desk and the `deliveries` row. B10: the real
Drive adapter + `drive` queue. Virus scan (v0.2 §4) and corrupt-RAW detection beyond darktable's own failure.
Proof-shot upload from the Pro app (`PROOF_SHOT`, single file through `putObject`). Multi-instance staging
(LocalDisk/Drive staging assume one API volume, ADR-0008).


## Carried forward from the Sprint 6–7 domain review
- **Unsafe-site delivery (T&C §8.3)** — files captured before a safety stop are delivered on full payment.
  UNSAFE_SITE is terminal and not uploadable today. Sprint 8 adds `UNSAFE_SITE → UPLOADING` to DOMAIN §2
  (staff-confirmed) before building delivery, so the T&C promise has a path.
- The 25% late-replacement credit and 50% access-denied charge are only review metadata today; when S8
  computes them they move into `pricing/engine` with the rates on the ruleset.
- Client-absent bookings can also carry a waiting charge — decide in the S8 non-attendance money review.
