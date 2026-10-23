# apps/portal — photographer web upload portal (Next.js App Router, port 3002)

Carries ~99% of media bytes (doc 02 §1, §7; ADR-0004, ADR-0014). Sprint 7.
- Token CSS from @clickco/design-tokens (src/shared/theme.ts) until @clickco/ui-web (shadcn) lands in S9.
  No raw colours, no one-off spacing: add a class to the token stylesheet.
- Types from @clickco/contracts. HTTP through src/shared/api.ts (envelope + ApiError from @clickco/api-client;
  the SDK is JSON-only, the uploader needs binary PUTs).
- src/features/upload is pure TypeScript with injected transport/checkpoints/hash/clock — keep it testable
  without a browser (vitest). features/X never imports features/Y; shared code lives in src/shared.
- Auth and RBAC are enforced server-side (ProGuard, own assignment only); the UI only reflects it.
- Tokens live in sessionStorage only. Never localStorage, never a provider (Drive) URL in the browser.
