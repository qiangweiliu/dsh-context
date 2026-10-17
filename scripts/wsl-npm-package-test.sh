#!/usr/bin/env bash
# npm 标准安装验证：npm pack -> 临时 profile 用 tarball 安装（等价于发布后的 registry 安装）
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"

PROFILES="$HOME/.dsh/profiles"
TEMP="ctxnpmpkg"
T="$PROFILES/$TEMP"
PKG="$HOME/dsh-plugins/ctx-mon-and-con"
TARBALL=""

echo "===== 0. npm 登录状态 ====="
npm whoami 2>&1 | head -2 || true

echo
echo "===== 1. npm pack（校验发布内容） ====="
cd "$PKG"
rm -f ctx-mon-and-con-*.tgz
timeout 120 npm pack --silent >/tmp/pack.out 2>/tmp/pack.err
echo "pack exit=$?"
cat /tmp/pack.out
tail -3 /tmp/pack.err
TARBALL=$(ls -t ctx-mon-and-con-*.tgz 2>/dev/null | head -1)
echo "tarball=$TARBALL"
if [ -n "$TARBALL" ]; then tar -tzf "$TARBALL" | head -20; fi

echo
echo "===== 2. 临时 profile 用 tarball 安装 ====="
rm -rf "$T"
cp -a "$PROFILES/web" "$T"
timeout 180 dsh plugin --profile "$TEMP" remove ctx-mon-and-con >/tmp/npm-remove.log 2>&1
echo "remove exit=$?"
timeout 300 dsh plugin --profile "$TEMP" add "$PKG/$TARBALL" >/tmp/npm-add.log 2>&1
echo "add exit=$?"
tail -15 /tmp/npm-add.log
grep -n "ctx-mon-and-con" "$T/package.json" | head -3 || true

echo
echo "===== 3. 官方 update ====="
timeout 300 dsh plugin --profile "$TEMP" update ctx-mon-and-con >/tmp/npm-upd.log 2>&1
echo "update exit=$?"
tail -8 /tmp/npm-upd.log

echo
echo "===== 4. 清理 ====="
rm -rf "$T"
rm -f "$PKG"/ctx-mon-and-con-*.tgz
echo cleaned
