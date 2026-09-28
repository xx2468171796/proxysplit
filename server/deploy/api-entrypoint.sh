#!/bin/sh
# Keep this entrypoint POSIX/LF-only; Linux containers execute it directly.
set -eu

export LICENSE_PRIVATE_KEY_PEM="$(cat /run/secrets/license-private.pem)"
export LICENSE_PUBLIC_KEY_PEM="$(cat /run/secrets/license-public.pem)"
# Claude Code 加速令牌（可选：没有这个文件时 /v1/accel/token 回 503，其余功能不受影响）
if [ -f /run/secrets/accel-token-private.pem ]; then
  export ACCEL_TOKEN_PRIVATE_KEY_PEM="$(cat /run/secrets/accel-token-private.pem)"
fi

exec "$@"
