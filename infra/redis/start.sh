#!/bin/sh
# Redis 7 for Clickco on Railway (docs/DEPLOY.md, "Redis over TLS").
#
# - TLS only: staging and production refuse a plain redis:// URL (apps/api/src/config/env.ts).
# - Two ACL users: `default` for the API, and `media-worker`, limited to the media-export queue and
#   the upload-budget keys (apps/api/CLAUDE.md "Media worker": never the API's credentials).
# - AOF persistence on the Railway volume and `noeviction`, which BullMQ requires.
#
# Variables (Doppler config `redis`): REDIS_PASSWORD, REDIS_WORKER_PASSWORD, QUEUE_PREFIX,
# REDIS_TLS_CERT, REDIS_TLS_KEY. The key and the ACL file live in a 0700 folder under /tmp, never
# on the volume.
set -eu

fail() {
  echo "redis start: $1" >&2
  exit 1
}

for name in REDIS_PASSWORD REDIS_WORKER_PASSWORD QUEUE_PREFIX REDIS_TLS_CERT REDIS_TLS_KEY; do
  eval "value=\${$name:-}"
  [ -n "$value" ] || fail "$name is not set"
done

# The ACL file is line-based: passwords and the prefix must not carry spaces or ACL syntax.
case "$REDIS_PASSWORD$REDIS_WORKER_PASSWORD" in
  *[!A-Za-z0-9]*) fail "passwords must be letters and digits only (use: openssl rand -hex 32)" ;;
esac
[ "${#REDIS_PASSWORD}" -ge 32 ] || fail "REDIS_PASSWORD must be at least 32 characters"
[ "${#REDIS_WORKER_PASSWORD}" -ge 32 ] || fail "REDIS_WORKER_PASSWORD must be at least 32 characters"
[ "$REDIS_PASSWORD" != "$REDIS_WORKER_PASSWORD" ] || fail "the two passwords must differ"
case "$QUEUE_PREFIX" in
  *[!a-z0-9-]* | -*) fail "QUEUE_PREFIX must match the API's (lowercase letters, digits, hyphens)" ;;
esac

umask 077
secrets_dir="$(mktemp -d /tmp/redis-secrets.XXXXXX)"
printf '%s\n' "$REDIS_TLS_CERT" > "$secrets_dir/redis.crt"
printf '%s\n' "$REDIS_TLS_KEY" > "$secrets_dir/redis.key"
cat > "$secrets_dir/users.acl" <<EOF
user default on >$REDIS_PASSWORD ~* &* +@all
user media-worker on >$REDIS_WORKER_PASSWORD resetkeys ~$QUEUE_PREFIX:media-export:* ~$QUEUE_PREFIX:storage:uploaded:* resetchannels +@all -@admin -@dangerous -@pubsub +info
EOF
chown -R redis:redis "$secrets_dir"
unset REDIS_PASSWORD REDIS_WORKER_PASSWORD REDIS_TLS_KEY

data_dir="${RAILWAY_VOLUME_MOUNT_PATH:-/data}"
mkdir -p "$data_dir"
cd "$data_dir"
# A fresh Railway volume holds lost+found, which Redis does not need.
rm -rf lost+found

# The official entrypoint chowns the data folder and drops to the redis user.
exec docker-entrypoint.sh redis-server \
  --port 0 \
  --tls-port 6379 \
  --tls-cert-file "$secrets_dir/redis.crt" \
  --tls-key-file "$secrets_dir/redis.key" \
  --tls-auth-clients no \
  --aclfile "$secrets_dir/users.acl" \
  --dir "$data_dir" \
  --appendonly yes \
  --maxmemory-policy noeviction
