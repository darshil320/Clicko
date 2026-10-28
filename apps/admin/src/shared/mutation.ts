'use client';

import type { Idempotent } from '@clickco/api-client';
import { newIdempotencyKey } from '@clickco/api-client';
import { toast } from '@clickco/ui-web';
import { type QueryKey, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import { describeError } from './errors';

export interface AdminMutationOptions<V, R> {
  readonly run: (variables: V, idem: Idempotent) => Promise<R>;
  /** The notice after success, e.g. "QA passed for CLK-4821". */
  readonly success: (variables: V, result: R) => string;
  /** What the change touched; refetched after success. */
  readonly invalidate: ReadonlyArray<QueryKey>;
  readonly onSuccess?: (result: R, variables: V) => void;
}

/**
 * Every admin action (ADR-0025 D6): the button disables while it runs, a toast on success, the
 * server's message on failure (403 → "You don't have access to this"; 401 → sign-in).
 * One Idempotency-Key per intent: a retry of the same action reuses it, a changed form gets a
 * new one, and a success retires it.
 */
export function useAdminMutation<V, R>(options: AdminMutationOptions<V, R>) {
  const client = useQueryClient();
  const intent = useRef<{ readonly body: string; readonly key: string } | null>(null);

  const keyFor = (variables: V): string => {
    const body = JSON.stringify(variables);
    if (intent.current?.body !== body) intent.current = { body, key: newIdempotencyKey() };
    return intent.current.key;
  };

  return useMutation({
    // Results (a temporary password, a decision) are read once and never kept (review L1).
    gcTime: 0,
    mutationFn: (variables: V) => options.run(variables, { idempotencyKey: keyFor(variables) }),
    onSuccess: async (result, variables) => {
      intent.current = null;
      toast.success(options.success(variables, result));
      options.onSuccess?.(result, variables);
      await Promise.all(
        options.invalidate.map((queryKey) => client.invalidateQueries({ queryKey })),
      );
    },
    onError: (error) => {
      const described = describeError(error);
      if (!described.signIn) toast.error(described.message);
    },
  });
}
