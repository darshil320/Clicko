---

name: clickco-module
description: The procedure and skeleton for creating a NestJS module in apps/api. Load when adding or restructuring any backend module.
---

# Creating a Clickco API module

## Order of work

1. Read docs/DOMAIN.md for the invariants this module owns.
2. If the module is pricing, bookings, dispatch, ledger, sla or payments:
   delegate to test-writer FIRST. Tests before implementation, no exceptions.
3. Add or confirm the Zod schemas in packages/contracts.
4. Then implement.

## Structure

```
modules/<name>/
├── <name>.module.ts
├── <name>.controller.ts       thin. validate, delegate, return.
├── <name>.service.ts          domain logic. the only place decisions happen.
├── repositories/
│   └── <name>.repository.ts   all DB access for this module
├── dto/                       re-exports from @clickco/contracts, never new types
├── events/                    domain event definitions
└── __tests__/
```

## Rules

- Modules communicate via injected services or domain events. Never query
  another module's tables.
- Validation through ZodValidationPipe using contracts schemas.
- Every state transition writes booking_status_events AND inserts a
  domain_events row in the same transaction. Outbox pattern, not fire-and-forget.
- Every admin mutation passes AuditLogInterceptor.
- Every money-mutating endpoint carries @Idempotent().
- Scheduled work is a BullMQ processor in jobs/, registered in infra/queues/.
  Never setTimeout, never node-cron.
- Geo queries use raw SQL with PostGIS, isolated in dispatch/repositories/.
- Storage access only through StoragePort.

## Before finishing

Delegate to domain-guardian. If the module touches auth, payments, uploads or
delivery links, also delegate to security-reviewer.
