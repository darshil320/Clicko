# apps/admin — the staff admin panel (Next.js 16 App Router)

ADR-0025 (Sprint 9). Staff sign in here to run bookings without SQL. Read AGENTS.md first: this
Next.js has breaking changes — check `node_modules/next/dist/docs/` before touching routing,
`proxy.ts`, CSS or caching.

## Shape

- `app/sign-in` — password → TOTP code, or TOTP enrolment on a first sign-in (secret + otpauth URI
  shown once as text to copy; no QR library).
- `app/(panel)/*` — the desks, inside `PanelShell` (src/features/shell): Bookings board +
  booking page, QA, Incidents, Dispatch (+ per-booking view), Breaches, Alerts, Staff.
- `app/dev/*` — the old console's simulators (status & roadmap, pincode, quote, booking and
  dispatch simulators). `app/dev/layout.tsx` calls `notFound()` unless
  `NODE_ENV === 'development'`; the nav's "Developer" section shows only in development. They
  call the API's `/dev` routes; the panel itself never does.
- `src/shared` — the admin API client (`api.ts`), session, role matrix (`access.ts`), formatters,
  error mapping, board filters, badge tones, query keys, the mutation hook. Pure modules have
  Vitest tests next to them.
- `src/features/<desk>` — one folder per desk. features/X never imports features/Y.

## Rules

- Compose `@clickco/ui-web` only (shadcn on Tailwind 4, themed from design tokens). No one-off
  components, no raw colours, sizes or font sizes — the kit's Tailwind theme only has token
  values (`text-sm` is the caption step, `p-4` is `space[4]`). Missing primitive → ask.
- Amber (`bg-primary`) is a fill with `text-primary-foreground`; never amber text.
- Types from `@clickco/contracts`; data through `adminApi` (`@clickco/api-client`
  `createAdminApiClient`) and TanStack Query. Lists are keyset pages (`usePagedList`, "Load more").
- Every action uses `useAdminMutation`: the button disables while it runs, a toast on success,
  the server's message on failure (403 → "You don't have access to this", 401 → sign-in), and one
  Idempotency-Key per intent (reused on retry, renewed when the form changes).
- Access (ADR-0025 D3) lives in `src/shared/access.ts`. The UI only hides what the API would
  refuse; the API decides.
- Dates DD MMM, times 12-hour am/pm, all IST; money via `formatMoney` (paise in, ₹ with lakh
  grouping out).

## Security (as the portal — ADR-0015)

- `proxy.ts` sets a per-request nonce CSP (`src/shared/security-headers.ts`): scripts and style
  elements need the nonce, `connect-src` is self + the API origin, no external origins at all.
  The root layout renders the token theme (`themeStylesheet()`) in a nonce'd `<style>`; the
  providers hand the nonce to Radix's scroll-lock style (`src/shared/style-nonce.ts`). Sonner's
  CSS comes from the kit's stylesheet as a same-origin file (its own runtime injection is refused
  by the CSP, harmlessly).
- Tokens live in sessionStorage only (`src/shared/session.ts`) — tab-scoped, never localStorage.
- 30 minutes without activity signs out (`src/shared/idle.ts`, `use-idle-sign-out.ts`).
- Sign-out revokes the refresh token (`POST /admin/auth/logout`) before leaving.
- A deploy build (`build:production`, `CLICKCO_DEPLOY=1`) refuses a non-https API URL.

## Commands

- `pnpm --filter @clickco/admin dev` (port 3001), `build`, `typecheck`, `test`.
- After moving routes, `npx next typegen` refreshes `.next/types` for `typecheck`.
