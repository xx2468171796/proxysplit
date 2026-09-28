#!/bin/sh
# Production-side half of release-all.ps1. It is intentionally POSIX shell so
# Windows AIs only need ssh/scp; all state-changing server work stays here.
set -eu

if [ "$#" -ne 5 ]; then
  echo "usage: remote-deploy.sh <root> <release-id> <archive> <exe> <manifest>" >&2
  exit 64
fi

root=$1
release_id=$2
archive=$3
exe=$4
manifest=$5
release_dir="$root/releases/$release_id"
stage_dir="$root/releases/.${release_id}.staging"
previous=$(readlink -f "$root/current" 2>/dev/null || true)
switched=0

case "$release_id" in
  *[!A-Za-z0-9._-]*|'') echo "invalid release id" >&2; exit 64 ;;
esac

cleanup() {
  rm -rf "$stage_dir"
}

rollback_link() {
  if [ "$switched" -eq 1 ] && [ -n "$previous" ] && [ -d "$previous" ]; then
    ln -sfn "$previous" "$root/current.rollback"
    mv -Tf "$root/current.rollback" "$root/current"
    if command -v nginx >/dev/null 2>&1; then nginx -t >/dev/null 2>&1 && nginx -s reload || true; fi
  fi
  cleanup
}

trap rollback_link INT TERM HUP
trap 'status=$?; if [ "$status" -ne 0 ]; then rollback_link; else cleanup; fi; exit "$status"' EXIT

mkdir -p "$root/releases" "$root/downloads" "$root/backups"
if command -v flock >/dev/null 2>&1; then
  exec 9>"$root/.release.lock"
  flock -n 9 || { echo "another release is running" >&2; exit 75; }
fi

test -f "$archive"
test -f "$exe"
test -f "$manifest"
test ! -e "$release_dir"

rm -rf "$stage_dir"
mkdir -p "$stage_dir"
tar -xzf "$archive" -C "$stage_dir"

test -f "$stage_dir/docker-compose.prod.yml"
test -f "$stage_dir/apps/site/index.html"
test -f "$stage_dir/apps/admin/dist/index.html"
test -f "$stage_dir/apps/api/src/server.ts"
chmod 0755 "$stage_dir/deploy/api-entrypoint.sh"
mv "$stage_dir" "$release_dir"

# The database backup is taken before forward-only migrations.
# 2026-09-25 起库在深圳共享 PG（宿主机 5432），旧容器 proxysplit-postgres-1 已停：用宿主机 pg_dump 连同一个库。
# 以前「docker exec … | gzip」在 pg_dump 失败时仍产出 20 字节的空 gzip 并通过 test -s，等于没备份就迁移（2026-09-28 发现）。
# 现在先落成明文再压缩，必须退出码为 0 且以「dump complete」结尾才继续。
backup="$root/backups/postgres-${release_id}.sql.gz"
db_url=$(sed -n 's/^DATABASE_URL=//p' "$root/secrets/runtime.env" | tail -n 1 | sed 's/@host\.docker\.internal:/@127.0.0.1:/')
[ -n "$db_url" ] || { echo "DATABASE_URL missing in runtime.env" >&2; exit 1; }
raw_dump="$root/backups/.postgres-${release_id}.sql"
pg_dump --no-owner "$db_url" > "$raw_dump"
tail -n 5 "$raw_dump" | grep -q 'PostgreSQL database dump complete' || { echo "pg_dump incomplete" >&2; exit 1; }
gzip -9 -c "$raw_dump" > "$backup"
rm -f "$raw_dump"
chmod 600 "$backup"
[ "$(stat -c %s "$backup")" -gt 1024 ] || { echo "backup suspiciously small" >&2; exit 1; }

cd "$release_dir"
docker compose -f docker-compose.prod.yml build api migrate
docker compose -f docker-compose.prod.yml --profile tools run --rm migrate
docker compose -f docker-compose.prod.yml up -d api

i=0
while [ "$i" -lt 40 ]; do
  health=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' proxysplit-api-1 2>/dev/null || true)
  [ "$health" = "healthy" ] && break
  i=$((i + 1))
  sleep 3
done
[ "${health:-}" = "healthy" ] || {
  docker logs --tail 100 proxysplit-api-1 >&2 || true
  echo "new API did not become healthy" >&2
  exit 1
}

# Publish immutable versioned files first, then atomically replace latest.
exe_name=$(basename "$exe")
manifest_name=$(basename "$manifest")
install -m 0644 "$exe" "$root/downloads/.${exe_name}.tmp"
mv -f "$root/downloads/.${exe_name}.tmp" "$root/downloads/$exe_name"
install -m 0644 "$manifest" "$root/downloads/.${manifest_name}.tmp"
mv -f "$root/downloads/.${manifest_name}.tmp" "$root/downloads/$manifest_name"
install -m 0644 "$exe" "$root/downloads/.proxysplit-latest.exe.tmp"
mv -f "$root/downloads/.proxysplit-latest.exe.tmp" "$root/downloads/proxysplit-latest.exe"
install -m 0644 "$manifest" "$root/downloads/.proxysplit-latest.manifest.json.tmp"
mv -f "$root/downloads/.proxysplit-latest.manifest.json.tmp" "$root/downloads/proxysplit-latest.manifest.json"

ln -sfn "$release_dir" "$root/current.next"
mv -Tf "$root/current.next" "$root/current"
switched=1

# 2026-09-26 起深圳改用 OpenResty（WAF / 统一入口），站点配置 /www/conf.d/proxysplit.zygskins.cn.conf 由服务器统一管理：
# 不覆盖它，只校验。站点静态文件经 current 软链接生效，不需要 reload。旧机器（/etc/nginx）仍按原方式安装。
if [ -f /www/conf.d/proxysplit.zygskins.cn.conf ] && command -v openresty >/dev/null 2>&1; then
  openresty -t
elif [ -d /etc/nginx/conf.d ]; then
  install -m 0644 "$release_dir/deploy/proxysplit.nginx.conf" /etc/nginx/conf.d/proxysplit.conf
  nginx -t
  nginx -s reload
else
  echo "no nginx / openresty site config found" >&2
  exit 1
fi
curl -fsS http://127.0.0.1:18780/health >/dev/null

printf 'release_dir=%s\nbackup=%s\nprevious=%s\n' "$release_dir" "$backup" "$previous"
