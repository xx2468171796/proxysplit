#!/bin/sh
# Keep this entrypoint POSIX/LF-only because it executes inside Linux containers.
set -eu

export LICENSE_PRIVATE_KEY_PEM="$(cat /run/secrets/license-private.pem)"
export LICENSE_PUBLIC_KEY_PEM="$(cat /run/secrets/license-public.pem)"

exec "$@"
