---

name: clickco-screen
description: The procedure for building a mobile screen in the Clickco client or pro app from a Figma frame. Load when creating or modifying any screen under apps/client/app or apps/pro/app.
---

# Building a Clickco screen

Follow every step. Do not skip step 2 or step 8.
1. Read the Figma frame via the Figma MCP `get_design_context` tool.

2. Check that every primitive you need already exists in packages/ui.
   If one is missing, STOP and tell Darshil. Never create a local one-off
   component — that is how a codebase ends up with four Buttons.

3. Route files under `app/` compose only. All logic lives in
   `src/features/<feature>/`.

4. Server state via a TanStack Query hook in `features/<feature>/hooks.ts`.
   Types from @clickco/contracts. Never an inline fetch.
   Client-only state via Zustand, in `features/<feature>/store.ts`.

5. Styling with NativeWind classes from our Tailwind preset only.
   No inline hex, no magic numbers, no StyleSheet mixed in.

6. Handle all four states explicitly: loading (skeleton, not a spinner),
   empty (illustration slot + one action), error (retry affordance), loaded.

7. SafeAreaView insets top and bottom. Primary CTA pinned to the bottom with
   a 16px gap above the inset. Minimum 44pt tap targets.

8. Delegate to the design-verifier subagent. Fix everything it reports.
   Repeat until its table is empty. A screen is not done until then.

## Content rules

₹ with Indian grouping. Real Indian names and cities in any placeholder.
Dates DD MMM. Times 12-hour with am/pm. No lorem ipsum, ever.
