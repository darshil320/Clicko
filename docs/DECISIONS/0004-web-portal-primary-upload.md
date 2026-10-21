# ADR-0004 — Web upload portal is the primary upload path

**Status:** Accepted · **Source:** doc 02 §1 (supersedes v0.2's on-site proxy upload)

Photographs live on SD cards, not phones. ~99% of bytes go through `apps/portal` on a laptop: resumable multipart (8–16 MB parts, 4 concurrent, IndexedDB checkpoints, exponential backoff, per-file checksums, declared-vs-received count reconciliation). The Pro app uploads only 2–3 proof-of-attendance shots, single-file.

Card-loss risk is covered by mandatory dual-card recording (Professional and above) and a 6-hour upload deadline. Removes all background-upload native work from the mobile apps.
