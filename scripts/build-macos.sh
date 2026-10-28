#!/bin/sh
# 在 Mac 上编正式版 ProxySplit.app（Apple 芯片），和 Windows 正式版同一份配置
# （build/release-kit/profile.json：商业 API、授权公钥、TLS 指纹、更新公钥）。
#   VERSION=1.10.9 sh scripts/build-macos.sh
# 前端先在 Windows 编好（frontend/dist，私有包在 Gitea），这里用 wails build -s 跳过前端。
# 产物：build/bin/ProxySplit.app（ad-hoc 签名）+ build/bin/ProxySplit-v<版本>-macos-arm64.zip
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"
: "${VERSION:?VERSION=x.y.z}"
echo "$VERSION" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || { echo "bad VERSION" >&2; exit 2; }
[ -f frontend/dist/index.html ] || { echo "frontend/dist 不在：先在 Windows 上 pnpm --dir frontend build" >&2; exit 2; }
sh scripts/fetch-core-darwin.sh

kit=build/release-kit
json() { sed -n "s/.*\"$1\": *\"\([^\"]*\)\".*/\1/p" "$kit/profile.json"; }
pem() { grep -v -- '-----' "$1" | tr -d '\n\r '; }
api=$(json commercialApiUrl)
spki=$(tr -d '\n\r ' < "$kit/tls-spki.txt")
lic=$(pem "$kit/license-public.pem")
rel=$(pem "$kit/release-public.pem")
case "$api" in https://*) ;; *) echo "commercialApiUrl 必须 https" >&2; exit 2 ;; esac

ld="-s -w -X main.appVersion=$VERSION"
ld="$ld -X proxysplit/internal/license.APIURL=$api -X proxysplit/internal/license.PublicKeyBase64=$lic -X proxysplit/internal/license.TLSSPKISHA256=$spki"
ld="$ld -X main.updateAPIURL=$api -X main.updatePublicKeyBase64=$rel -X main.updateTLSSPKISHA256=$spki"

export CGO_ENABLED=1
wails build -s -clean -trimpath -platform darwin/arm64 -ldflags "$ld"
# APFS 默认不分大小写：proxysplit.app 和 ProxySplit.app 是同一个目录，经临时名改大小写
out=build/bin/ProxySplit.app
mv build/bin/proxysplit.app build/bin/ps-tmp.app && mv build/bin/ps-tmp.app "$out"
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $VERSION" -c "Set :CFBundleVersion $VERSION"   -c "Set :CFBundleIdentifier cn.zygskins.proxysplit" -c "Set :LSMinimumSystemVersion 11.0"   -c "Set :CFBundleGetInfoString 按应用分流的代理工具 · https://proxysplit.zygskins.cn" "$out/Contents/Info.plist"
# Apple 芯片只跑签过名的程序；没有开发者账号就用 ad-hoc 签名（-s -）
codesign --force --deep -s - "$out"
codesign --verify --deep --strict "$out"
zip="build/bin/ProxySplit-v$VERSION-macos-arm64.zip"
rm -f "$zip"
ditto -c -k --keepParent "$out" "$zip"
echo "app: $out"
echo "zip: $zip $(shasum -a 256 "$zip" | cut -d' ' -f1) $(stat -f %z "$zip")"
