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
    nginx -t >/dev/null 2>&1 && nginx -s reload || true
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
backup="$root/backups/postgres-${release_id}.sql.gz"
docker exec proxysplit-postgres-1 pg_dump -U proxysplit proxysplit | gzip -9 > "$backup"
test -s "$backup"

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

install -m 0644 "$release_dir/deploy/proxysplit.nginx.conf" /etc/nginx/conf.d/proxysplit.conf
nginx -t
nginx -s reload
curl -fsS http://127.0.0.1:18780/health >/dev/null

printf 'release_dir=%s\nbackup=%s\nprevious=%s\n' "$release_dir" "$backup" "$previous"
