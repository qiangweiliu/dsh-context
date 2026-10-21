#!/usr/bin/env bash
# 在 WSL 的 DSH profile 里安装 ctx-mon-and-con，并核对安装结果。
#
# 用法（在 Windows 侧执行）：
#   wsl.exe -d Ubuntu-24.04 -e bash <仓库>/scripts/wsl-install.sh [profile]
#
# 默认 profile=web；插件源码默认取本仓库的 ctx-mon-and-con，并复制到 ~/dsh-plugins/ctx-mon-and-con
# （不直接在 /mnt/c 上 link 安装：drvfs 上的符号链接/性能都不适合做 profile 依赖）。
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROFILE="${1:-web}"
SRC="${CTX_SRC:-$SCRIPT_DIR/../ctx-mon-and-con}"
DEST="$HOME/dsh-plugins/ctx-mon-and-con"
P="$HOME/.dsh/profiles/$PROFILE"
PKG="ctx-mon-and-con"

say() { printf '%s\n' "$*"; }
fail() { printf 'FAIL - %s\n' "$*"; FAILED=1; }
ok() { printf 'ok   - %s\n' "$*"; }
FAILED=0

say "== 目标 profile=$PROFILE 源码=$SRC"
[ -d "$P" ] || { say "找不到 profile 目录：$P"; exit 1; }

say "== 1. 同步插件源码到 ~/dsh-plugins"
rm -rf "$DEST"
mkdir -p "$HOME/dsh-plugins"
cp -a "$SRC" "$DEST"
rm -rf "$DEST/test/deps"
ok "源码已复制到 $DEST（$(ls "$DEST" | wc -l) 个条目）"

say "== 2. 离线自检（不需要 DSH 运行）"
if (cd "$DEST" && node test/static.mjs >/tmp/ctx-static.log 2>&1); then
  ok "static.mjs：$(tail -1 /tmp/ctx-static.log)"
else
  fail "static.mjs 失败，见 /tmp/ctx-static.log"
fi

say "== 3. 检查装前状态"
if node -e "const p=require('$P/package.json'); const b=p.dsh?.profile?.bundles??[]; const d=Object.keys(p.dependencies??{}); process.exit(b.includes('$PKG')||d.includes('$PKG')?0:1)"; then
  say "插件已经装过：先执行 dsh plugin --profile $PROFILE remove $PKG 再重跑"
  exit 1
fi
ok "装前未安装"

say "== 4. 安装"
if dsh plugin --profile "$PROFILE" add "$DEST" >/tmp/ctx-install.log 2>&1; then
  ok "dsh plugin add 成功：$(grep -E '^\+\s' /tmp/ctx-install.log | tail -1 | xargs)"
else
  fail "dsh plugin add 失败："; tail -5 /tmp/ctx-install.log; exit 1
fi

say "== 5. 核对安装结果"
node -e "
const fs=require('fs');
const p=JSON.parse(fs.readFileSync('$P/package.json','utf8'));
const b=p.dsh?.profile?.bundles??[]; const d=Object.keys(p.dependencies??{});
console.log('ok   - bundles 含该包: '+b.includes('$PKG'));
console.log('ok   - dependencies 含该包: '+d.includes('$PKG'));
" || fail "package.json 核对失败"
[ -e "$P/node_modules/$PKG" ] && ok "node_modules/$PKG 存在（link -> $(readlink -f "$P/node_modules/$PKG")）" || fail "node_modules/$PKG 不存在"

ROWS=$(dsh --profile "$PROFILE" --dump-config 2>/tmp/ctx-dump.err | grep -c 'ctx-mon-and-con' || true)
[ "$ROWS" -gt 0 ] && ok "--dump-config 出现该行（$ROWS 处）" || fail "--dump-config 未出现该行（见 /tmp/ctx-dump.err）"
grep -q 'patch: entry' /tmp/ctx-dump.err && say "（提示：cordis.patch.yml 里有既存的 patch 警告，与本插件无关）"

VER=$(node -e "console.log(require('$P/node_modules/$PKG/package.json').version)")
say "== 安装完成：$PKG@$VER 已进入 profile $PROFILE"

say "== 6. 热加载检查（运行中的 Web 实例）"
HOT_URL="${CTX_URL:-}"
if [ -z "$HOT_URL" ] && [ -f /tmp/ctx-ui-version.log ]; then
  HOT_URL=$(grep -o 'http://[^ ]*token=[A-Za-z0-9_-]*' /tmp/ctx-ui-version.log | tail -1)
fi
if [ -n "$HOT_URL" ]; then
  if node "$SCRIPT_DIR/wait-for-ctx-plugin.mjs" "$HOT_URL" 15; then
    ok "插件已在运行中的页面热加载（无需重启 DSH）"
  else
    say "  - 未自动就绪：先刷新页面；只有替换已安装包/宿主模块才需要重启 DSH"
  fi
else
  say "  - 未发现运行中的 Web 实例；启动 profile 后会随启动加载"
fi

say ""
say "接下来："
say "  - dsh 正在运行：HMR 会在数秒内挂载插件；页面没更新就刷新一次（无需重启 DSH）"
say "  - dsh 未运行：启动后生效；会话里发 /ctx 看用量"
say "  - 升级/替换已安装包：DSH 会缓存模块代际，这种场景仍需重启进程"
say "  - 想测自动压缩：把控制行挂进 agent preset："
say "      - id: ctx-mon-and-con-control"
say "        name: 'ctx-mon-and-con/control'"
say "        config: { mode: idle }"
say "  - 卸载：dsh plugin --profile $PROFILE remove $PKG"
exit 0
