#!/usr/bin/env bash
# 在 WSL 里验证 agent-embodiment：同步源码 → 单元/集成测试 → 安装到 profile → 启动 web → 校验状态接口。
#
# 用法（Windows PowerShell，仓库在 C:\Users\40410\Desktop\context）：
#   wsl.exe -d Ubuntu-24.04 -e bash /mnt/c/Users/40410/Desktop/context/scripts/wsl-verify.sh [profile]
#
# 默认 profile=web。脚本只操作 ~/dsh-plugins/agent-embodiment 与指定 profile；
# 结束后会停掉它启动的 dsh 实例。
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"

PROFILE="${1:-web}"
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/../agent-embodiment" && pwd)"
DEST="$HOME/dsh-plugins/agent-embodiment"
P="$HOME/.dsh/profiles/$PROFILE"
PORT="${PORT:-3080}"
PKG="agent-embodiment"
FAILED=0

say() { printf '%s\n' "$*"; }
ok() { say "ok   - $*"; }
fail() { say "FAIL - $*"; FAILED=1; }

say "== 0. 环境"
command -v node >/dev/null || { fail "找不到 node"; exit 1; }
command -v dsh >/dev/null || { fail "找不到 dsh（~/.local/bin/dsh）"; exit 1; }
say "node $(node -v) · dsh $(dsh --version 2>/dev/null || echo '?')"
say "profile=$PROFILE 源码=$SRC"

[ -d "$P" ] || { fail "找不到 profile 目录：$P"; exit 1; }

say "== 1. 同步源码到 ~/dsh-plugins"
rm -rf "$DEST"
mkdir -p "$HOME/dsh-plugins"
cp -a "$SRC" "$DEST"
rm -rf "$DEST/test/deps"
ok "已复制 $(ls "$DEST" | wc -l) 个条目"

say "== 2. 语法与单元测试"
if (cd "$DEST" && node --check index.js && node --check control.js && node --check client.js && node --check persist.js); then
  ok "node --check 通过"
else
  fail "node --check 失败"
fi
if (cd "$DEST" && npm test >/tmp/embody-unit.log 2>&1); then
  ok "npm test：$(grep -E '项通过' /tmp/embody-unit.log | tr '\n' ' ')"
else
  fail "npm test 失败"; tail -20 /tmp/embody-unit.log
fi

say "== 3. 集成测试（需要 app.asar 或已准备的 test/deps）"
ASAR=""
for candidate in "$LOCALAPPDATA/Programs/DeepSeek Harness/resources/app.asar" \
  "/mnt/c/Users/$USER/AppData/Local/Programs/DeepSeek Harness/resources/app.asar" \
  "/mnt/e/tool/dsh/resources/app.asar"; do
  [ -f "$candidate" ] && ASAR="$candidate" && break
done
if [ -n "$ASAR" ] && (cd "$DEST" && DSH_ASAR="$ASAR" node test/prepare-deps.mjs >/tmp/embody-deps.log 2>&1); then
  if (cd "$DEST" && node test/control.mjs >/tmp/embody-int.log 2>&1 && node test/smoke.mjs >>/tmp/embody-int.log 2>&1 && node test/prompt-state.mjs >>/tmp/embody-int.log 2>&1); then
    ok "集成：$(grep -E '项通过' /tmp/embody-int.log | tr '\n' ' ')"
  else
    fail "集成测试失败"; tail -20 /tmp/embody-int.log
  fi
else
  fail "找不到可用的 app.asar（设置 DSH_ASAR 后重跑）"
fi

say "== 4. 安装到 profile $PROFILE"
if node -e "const p=require('$P/package.json'); const b=p.dsh?.profile?.bundles??[]; const d=Object.keys(p.dependencies??{}); process.exit(b.includes('$PKG')||d.includes('$PKG')?0:1)" 2>/dev/null; then
  dsh plugin --profile "$PROFILE" remove "$PKG" >/tmp/embody-remove.log 2>&1 && ok "已移除旧安装" || fail "移除旧安装失败"
fi
if dsh plugin --profile "$PROFILE" add "$DEST" >/tmp/embody-install.log 2>&1; then
  ok "dsh plugin add 成功：$(grep -E '^\+\s' /tmp/embody-install.log | tail -1 | xargs)"
else
  fail "dsh plugin add 失败"; tail -10 /tmp/embody-install.log
fi
node -e "
const p=require('$P/package.json');
const b=p.dsh?.profile?.bundles??[]; const d=Object.keys(p.dependencies??{});
console.log((b.includes('$PKG')||d.includes('$PKG'))?'ok   - profile 已登记 $PKG':'FAIL - profile 未登记 $PKG');
" || fail "profile 登记检查失败"

say "== 5. 启动 web 并校验状态接口"
if [ "${SKIP_START:-0}" = "1" ]; then
  say "（SKIP_START=1，跳过启动与状态校验）"
else
pkill -f "dsh.*--profile $PROFILE" >/dev/null 2>&1 || true
sleep 1
( cd "$HOME" && setsid nohup dsh --profile "$PROFILE" > /tmp/embody-web.log 2>&1 < /dev/null & )
TOKEN=""
for i in $(seq 1 60); do
  TOKEN=$(grep -o 'token=[A-Za-z0-9_-]*' /tmp/embody-web.log 2>/dev/null | head -1 | cut -d= -f2)
  [ -n "$TOKEN" ] && break
  sleep 1
done
[ -n "$TOKEN" ] || { fail "web 未在 60s 内打印 token"; tail -20 /tmp/embody-web.log; }

if [ -n "$TOKEN" ]; then
  JAR=/tmp/embody-cookies.txt
  rm -f "$JAR"
  for i in $(seq 1 30); do
    code=$(curl -s -c "$JAR" -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/?token=$TOKEN" || true)
    [ "$code" = "200" ] && break
    sleep 1
  done
  STATUS=$(curl -s -b "$JAR" -H 'accept: application/json' "http://127.0.0.1:$PORT/api/agent-embodiment/status" || true)
  VERSION=$(printf '%s' "$STATUS" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{console.log(JSON.parse(s).version||'')}catch{console.log('')}})")
  if [ "$VERSION" = "$(node -p "require('$DEST/package.json').version")" ]; then
    ok "状态接口版本 = $VERSION"
  else
    fail "状态接口版本不匹配：got '$VERSION'"
    say "  响应片段：$(printf '%s' "$STATUS" | head -c 200)"
  fi
  CONTROL=$(printf '%s' "$STATUS" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const j=JSON.parse(s);console.log(j.control?String(j.control.active):'')}catch{console.log('')}})")
  [ -n "$CONTROL" ] && ok "control.active=$CONTROL" || fail "状态接口缺少 control 字段"
fi
fi

say "== 6. 清理本次启动的实例"
pkill -f "dsh.*--profile $PROFILE" >/dev/null 2>&1 || true
say "日志：/tmp/embody-unit.log /tmp/embody-int.log /tmp/embody-install.log /tmp/embody-web.log"

if [ "$FAILED" -ne 0 ]; then
  say "RESULT=FAIL"; exit 1
fi
say "RESULT=PASS"
