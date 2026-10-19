#!/usr/bin/env bash
# 标准安装/更新验证：在临时 profile 里用 GitHub spec 安装，再走官方 update。
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"

PROFILES="$HOME/.dsh/profiles"
TEMP="ctxstd"
T="$PROFILES/$TEMP"

echo "===== 0. npm 连通性/包名 ====="
timeout 25 npm view ctx-mon-and-con version 2>&1 | head -3 || echo "npm view failed/timeout"
timeout 25 npm ping 2>&1 | tail -2 || echo "npm ping failed/timeout"

echo
echo "===== 1. 复制 web profile 到临时 profile ====="
rm -rf "$T"
cp -a "$PROFILES/web" "$T"
echo "copied -> $T"
grep -n "ctx-mon-and-con" "$T/package.json" || true

echo
echo "===== 2. 先从临时 profile 移除本地 link 安装 ====="
timeout 180 dsh plugin --profile "$TEMP" remove ctx-mon-and-con >/tmp/std-remove.log 2>&1
echo "remove exit=$?"
tail -5 /tmp/std-remove.log
grep -n "ctx-mon-and-con" "$T/package.json" || echo "not present after remove"

echo
echo "===== 3. GitHub 标准安装 ====="
timeout 420 dsh plugin --profile "$TEMP" add "github:qiangweiliu/dsh-context#path:/ctx-mon-and-con" >/tmp/std-add.log 2>&1
echo "add exit=$?"
tail -25 /tmp/std-add.log

echo
echo "===== 4. 复核 profile ====="
grep -n -A3 "ctx-mon-and-con" "$T/package.json" || true
ls -la "$T/node_modules/ctx-mon-and-con" 2>/dev/null | head -3 || true
timeout 120 dsh --profile "$TEMP" --dump-config >/tmp/std-dump.txt 2>&1
echo "dump exit=$?"
grep -n -A6 "ctx-mon-and-con" /tmp/std-dump.txt | head -20

echo
echo "===== 5. 官方 update ====="
timeout 420 dsh plugin --profile "$TEMP" update ctx-mon-and-con >/tmp/std-upd.log 2>&1
echo "update exit=$?"
tail -20 /tmp/std-upd.log

echo
echo "===== 6. 清理临时 profile ====="
rm -rf "$T"
echo "removed $T"
