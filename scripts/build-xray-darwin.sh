#!/bin/sh
# 在 Mac 上按 bin/darwin/xray-release.json 固定的上游提交复现编译 Xray（darwin/arm64），
# 参数与 scripts/build-xray.ps1 / 上游发布流程一致。产物 bin/darwin/xray，打印 sha256。
# 上传（手动）：Gitea generic gonggong/xray/<版本>/xray-darwin-arm64 + 深圳 /opt/proxysplit/downloads/xray/<版本>/。
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
meta="$root/bin/darwin/xray-release.json"
commit=$(sed -n 's/.*"upstreamCommit": *"\([0-9a-f]*\)".*/\1/p' "$meta")
gover=$(sed -n 's/.*"go": *"\([^"]*\)".*/\1/p' "$meta")
[ ${#commit} -eq 40 ] || { echo "xray-release.json 需要 40 位 upstreamCommit" >&2; exit 2; }
export GOTOOLCHAIN="go$gover" GOFLAGS=-mod=mod CGO_ENABLED=0 GOOS=darwin GOARCH=arm64
dir=$(go mod download -json "github.com/xtls/xray-core@$commit" | sed -n 's/.*"Dir": *"\([^"]*\)".*/\1/p')
[ -n "$dir" ] || { echo "模块下载失败" >&2; exit 1; }
work=$(mktemp -d)
trap 'chmod -R u+w "$work"; rm -rf "$work"' EXIT
cp -R "$dir/." "$work/" && chmod -R u+w "$work"
short=$(echo "$commit" | cut -c1-7)
out="${OUT:-$root/bin/darwin/xray}"
(cd "$work" && go build -o "$out" -trimpath -buildvcs=false '-gcflags=all=-l=4' "-ldflags=-X github.com/xtls/xray-core/core.build=$short -s -w -buildid=" ./main)
"$out" version | head -1
echo "sha256 $(shasum -a 256 "$out" | cut -d' ' -f1)"
