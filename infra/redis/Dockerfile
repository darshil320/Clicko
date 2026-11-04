# Redis 7 for Clickco on Railway: TLS only, ACL users for the API and the media worker, AOF on
# the volume (start.sh). Railway: root directory /infra/redis, config /infra/redis/railway.json,
# a volume at /data. docs/DEPLOY.md, "Redis over TLS".
FROM redis:7.4-alpine
COPY --chmod=0755 start.sh /usr/local/bin/clickco-redis-start
EXPOSE 6379
CMD ["/usr/local/bin/clickco-redis-start"]
