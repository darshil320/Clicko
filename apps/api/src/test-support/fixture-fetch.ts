import type { FetchLike } from '../common/http/fetch-like';

/** One request a provider adapter made, as the fake fetch saw it. */
export interface RecordedRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string | undefined;
}

/** A recorded provider response: a JSON body, or raw text (an HTML error page from a proxy). */
export type FixtureReply =
  | { readonly status: number; readonly body: unknown }
  | { readonly status: number; readonly raw: string };

/**
 * A FetchLike that answers from the given replies in order (the last one repeats) and records
 * every request. An Error reply is thrown, as fetch does on a network failure. Never the network.
 */
export function fixtureFetch(...replies: (FixtureReply | Error)[]) {
  const requests: RecordedRequest[] = [];
  let next = 0;
  const fetch: FetchLike = async (url, init) => {
    requests.push({ url, method: init.method, headers: init.headers, body: init.body });
    const reply = replies[Math.min(next, replies.length - 1)];
    next += 1;
    if (!reply) throw new Error('fixtureFetch: no reply configured');
    if (reply instanceof Error) throw reply;
    const text = 'raw' in reply ? reply.raw : JSON.stringify(reply.body);
    return { status: reply.status, text: async () => text };
  };
  return { fetch, requests };
}
