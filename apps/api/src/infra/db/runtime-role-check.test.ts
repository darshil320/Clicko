import { describe, expect, it, vi } from 'vitest';
import { checkRuntimeRole, type RuntimeRole, runtimeRoleProblem } from './runtime-role-check';

const appRole: RuntimeRole = {
  roleName: 'clickco_api',
  tableOwner: 'clickco',
  actsAsOwner: false,
  superuser: false,
};
const ownerRole: RuntimeRole = { ...appRole, roleName: 'clickco', actsAsOwner: true };

describe('runtimeRoleProblem (security audit M4)', () => {
  it('accepts a least-privilege role that neither owns the tables nor is a superuser', () => {
    expect(runtimeRoleProblem(appRole)).toBeNull();
  });

  it('flags the role that owns audit_logs', () => {
    expect(runtimeRoleProblem(ownerRole)).toMatch(/owns audit_logs/);
  });

  it('flags a member of the owning role, which can act as the owner', () => {
    expect(runtimeRoleProblem({ ...appRole, roleName: 'someone', actsAsOwner: true })).toMatch(
      /owns audit_logs/,
    );
  });

  it('flags a superuser, which can disable any trigger', () => {
    expect(runtimeRoleProblem({ ...appRole, superuser: true })).toMatch(/superuser/);
  });
});

describe('checkRuntimeRole (security audit M4)', () => {
  it.each(['staging', 'production'] as const)(
    'M4: refuses to start in %s when the runtime role owns the append-only tables',
    async (nodeEnv) => {
      await expect(checkRuntimeRole(async () => ownerRole, nodeEnv)).rejects.toThrow(
        /MIGRATION_DATABASE_URL/,
      );
    },
  );

  it.each(['staging', 'production'] as const)(
    'M4: starts in %s with a least-privilege runtime role',
    async (nodeEnv) => {
      await expect(checkRuntimeRole(async () => appRole, nodeEnv)).resolves.toBeUndefined();
    },
  );

  it.each(['development', 'test'] as const)(
    'skips the check (and the query) in %s, where the local owner role is expected',
    async (nodeEnv) => {
      const read = vi.fn(async () => ownerRole);
      await expect(checkRuntimeRole(read, nodeEnv)).resolves.toBeUndefined();
      expect(read).not.toHaveBeenCalled();
    },
  );

  it('fails closed in production when the role cannot be read (e.g. audit_logs is missing)', async () => {
    const read = async (): Promise<RuntimeRole> => {
      throw new Error('relation "audit_logs" does not exist');
    };
    await expect(checkRuntimeRole(read, 'production')).rejects.toThrow(/audit_logs/);
  });
});
