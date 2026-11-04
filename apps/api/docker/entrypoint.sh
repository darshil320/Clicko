#!/bin/sh
# Runs before every API / media-worker process (tini → this → node).
#
# REDIS_CA_CERT (optional): the PEM of the CA that signed Redis's TLS certificate. Staging and
# production must reach Redis over rediss:// (env.ts), and a Redis on a private network (Railway)
# or a provider with its own CA presents a certificate Node does not trust by default. Hosting
# platforms pass variables, not files, so the PEM is written to /tmp (writable even with a
# read-only root filesystem) and handed to Node through NODE_EXTRA_CA_CERTS. A CA certificate is
# public: it is not a secret. See docs/DEPLOY.md, "Redis over TLS".
set -eu

if [ -n "${REDIS_CA_CERT:-}" ]; then
  ca_file="$(mktemp /tmp/redis-ca.XXXXXX)"
  printf '%s\n' "$REDIS_CA_CERT" > "$ca_file"
  export NODE_EXTRA_CA_CERTS="$ca_file"
fi

exec "$@"
