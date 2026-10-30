# apps/admin — the staff admin panel (Next.js 16 App Router)

ADR-0025 (Sprint 9). Staff sign in here to run bookings without SQL. Read AGENTS.md first: this
Next.js has breaking changes — check `node_modules/next/dist/docs/` before touching routing,
`proxy.ts`, CSS or caching.

## Shape

- `app/sign-in` — password → (temporary password only: choose a new one, ADR-0026 D7) → TOTP
  code, or TOTP enrolment on a first sign-in (secret + otpauth URI shown once as text to copy; no
  QR library). The new password travels with the code; the server saves both or neither.
- `app/(panel)/today` — "Today", the home (`/` lands here): `src/features/today`, fed by
  `GET /admin/overview` (`src/shared/overview.ts`, one query shared with the nav's live counts).
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

## UX rules (ADR-0026 D8) — every desk follows these

The bar is Urban Company / Stripe / Linear: calm, plain, one obvious next step.
- **Page shape.** `PageHeader` (optional `eyebrow`, title, one-line description, actions with the
  primary one last) → the list or record. Sections inside a page use `SectionHeader`. Spacing
  comes from the kit: `gap-8` between page sections, `gap-3`/`gap-4` inside them.
- **One primary action per screen.** Only one amber (`variant="default"`) button in view; the
  rest are `outline` / `ghost`. Amber is never text.
- **Quick actions open in a `SideSheet`** over the list (title, one line of context, the form,
  the primary action pinned at the bottom). A long record gets its own page. Destructive or
  irreversible steps confirm in a dialog that says what will happen, in plain words with names
  and amounts: "₹2,500 goes back to Priya Sharma's card", not "Confirm refund?".
- **Plain language.** No raw codes on screen (`formatCode` at most, better a written label);
  ₹ with Indian grouping (`formatMoney`); dates DD MMM, times 12-hour am/pm, IST.
- **Times.** For "when" columns and deadlines use `<RelativeTime at={iso} now={now} />` ("in 2 h",
  "3 days ago"; the exact IST moment is the hover title). Share one `useNow()` per table.
- **Numbers.** Headline counts use `StatCard` in a `StatGrid` (tone `attention`/`urgent` only
  when something waits; the hint says why). Inline counts use `CountBadge`.
- **Empty states say what is done:** "All caught up" with `tone="success"` for a cleared queue;
  otherwise what will appear here and, if there is one, the one action.
- **Today and the nav's live counts** come from the overview's source registry
  (`apps/api/src/modules/admin/overview/overview.registry.ts`). A desk with a queue registers one
  source (desk, count in its cities, title, one-line sentence, button label) — the panel needs no
  change. Never fetch counts for the nav from a desk page.
- **⌘K / Ctrl+K** (`src/features/shell/command-menu.tsx`) jumps to any desk and finds bookings;
  new desks appear automatically from `NAV`.
- **Responsive and accessible.** Laptop and tablet first: the sidebar shows from `lg`, a drawer
  below it. Every control is reachable by keyboard with a visible focus ring; never colour alone
  (a badge carries its word); AA contrast (the kit's theme tests enforce it).

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
- Passwords (ADR-0026 D7): temporary ones last 72 h and are replaced at first sign-in; "Change
  password" (account menu or ⌘K) needs the current password and an authenticator code and signs
  out every other session; a SUPER_ADMIN's "Reset password" (Staff desk) shows a new temporary
  password once. Temporary and new passwords live only in component state, never in storage or
  the query cache (mutations use `gcTime: 0`).
- A deploy build (`build:production`, `CLICKCO_DEPLOY=1`) refuses a non-https API URL.

## Commands

- `pnpm --filter @clickco/admin dev` (port 3001), `build`, `typecheck`, `test`.
- After moving routes, `npx next typegen` refreshes `.next/types` for `typecheck`.
