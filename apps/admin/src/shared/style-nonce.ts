'use client';

/**
 * Radix's scroll lock (react-remove-scroll → react-style-singleton → get-nonce) injects a <style>
 * element and stamps it with `__webpack_nonce__` when that global exists. Under the nonce CSP
 * (style-src-elem 'nonce-…') an unstamped element would be refused, so hand it this page's
 * nonce, read from the server-rendered nonce'd elements. Browsers hide the nonce attribute's
 * value from the DOM but keep the `nonce` property readable by same-origin script.
 */
export function shareStyleNonce(doc: Document): void {
  const stamped = doc.querySelector<HTMLStyleElement | HTMLScriptElement>(
    'style[nonce], script[nonce]',
  );
  const nonce = stamped?.nonce;
  if (nonce) (globalThis as { __webpack_nonce__?: string }).__webpack_nonce__ = nonce;
}
