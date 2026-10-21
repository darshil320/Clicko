# ADR-0001 — Google Drive (5 TB Shared Drive) over R2 at launch

**Status:** Accepted · **Source:** v0.2 §1, §4, §5

Launch storage is a service-account-owned Google Workspace Shared Drive. All access goes through `StoragePort`; `GoogleDriveAdapter` is the only implementation at launch.

**Tripwire:** a sustained **18 events/day** starts the R2 migration (Drive API upload ceiling ≈ 23 events/day cannot be engineered around). The migration is one new adapter class.

**Consequences:** permanent delete only (`files.delete`, never trash); every Drive call through a BullMQ queue with backoff; quota alerts at 60/75/90%; rolling-24h upload bytes tracked in Redis, new sessions refused past 85%.
