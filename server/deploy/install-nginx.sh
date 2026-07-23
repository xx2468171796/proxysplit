#!/bin/sh
set -eu

config=/etc/nginx/nginx.conf
include_line='    include /www/conf.d/proxysplit.zygskins.cn.conf;'
backup="${config}.bak.proxysplit.$(date +%Y%m%d%H%M%S)"

cp -a "$config" "$backup"
if ! grep -qxF "$include_line" "$config"; then
    python3 - "$config" "$include_line" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
include_line = sys.argv[2]
text = path.read_text()
anchor = "    include /www/conf.d/lingxi.zygskins.cn.conf;\n"
if anchor not in text:
    raise SystemExit("nginx include anchor not found")
path.write_text(text.replace(anchor, anchor + include_line + "\n", 1))
PY
fi

if nginx -t; then
    systemctl reload nginx
else
    cp -a "$backup" "$config"
    nginx -t
    exit 1
fi

printf 'installed: %s\n' "$include_line"
systemctl is-active nginx
