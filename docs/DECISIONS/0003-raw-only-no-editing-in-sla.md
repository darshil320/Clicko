# ADR-0003 — 48 h SLA covers RAW + automated JPEG export only; editing is a separate product

**Status:** Accepted · **Source:** v0.2 §1, §2, §3.2

The published 48 h promise (T0 = `actual_check_out`) delivers unedited RAW plus a server-side neutral-profile JPEG conversion (`darktable-cli`). JPEG conversion is format conversion, not editing, and is described that way in the T&C.

Clickco Edit is a paid post-delivery upsell with its own 5–7 day turnaround and a central editor pool (see ADR-0005 for pricing and launch scope).
