# ADR-0008 — Hosting at launch

**Status:** Accepted (reversible; revisit at the Drive tripwire)

| Piece | Host |
|---|---|
| `apps/api` + BullMQ workers + JPEG export worker | Railway (Docker images; JPEG worker image carries `darktable-cli`) |
| Postgres 16 + PostGIS | Railway Postgres using the `postgis/postgis:16` image, daily backups + PITR |
| Redis 7 | Railway Redis |
| `apps/web`, `apps/admin`, `apps/portal` | Vercel |
| Mobile builds | EAS |
| DNS / CDN | Cloudflare |
| Secrets | Doppler, synced to Railway and Vercel. Never in the repo, never in `EXPO_PUBLIC_*`. |
| Errors / analytics | Sentry, PostHog |

Doc 03 left "AWS or Railway" open. Railway wins at launch on setup time for a solo build; nothing here prevents moving the API to AWS later because everything ships as a container.
