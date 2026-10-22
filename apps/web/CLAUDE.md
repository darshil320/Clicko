# apps/web — Next.js App Router (static export)

Sprint 0 scope: legal pages only (Razorpay KYC needs them live). Marketing site with programmatic
city × category pages comes in S12.
- T&C wording comes from `docs/clickco-terms-conditions-v2.md`, rendered by `src/legal/render.ts`
  with values from `src/legal/config.ts`. Never copy or fork the T&C text into the app.
- `pnpm build:production` (LEGAL_STRICT=1) refuses to build while any field is `TO_BE_CONFIRMED`.
- Styles come from `src/theme.ts`, generated from @clickco/design-tokens. No raw colours.
