#!/usr/bin/env bash
# 在 WSL 的 DSH profile 里卸载 ctx-mon-and-con，并核对是否有残留。
# 用法：wsl.exe -d Ubuntu-24.04 -e bash /mnt/c/Users/40410/Desktop/context/scripts/wsl-uninstall.sh [profile]
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"

PROFILE="${1:-web}"
P="$HOME/.dsh/profiles/$PROFILE"
PKG="ctx-mon-and-con"
FAILED=0
say() { printf '%s\n' "$*"; }
ok() { printf 'ok   - %s\n' "$*"; }
fail() { printf 'FAIL - %s\n' "$*"; FAILED=1; }

[ -d "$P" ] || { say "找不到 profile：$P"; exit 1; }
SNAP=/tmp/dsh-uninstall-snap
rm -rf "$SNAP"; mkdir -p "$SNAP"

# 快照：profile 文件哈希 + node_modules 列表 + 管理器日志列表
( cd "$P" && find . -maxdepth 1 -type f -printf '%f\n' | sort | while read -r f; do sha256sum "$f"; done ) > "$SNAP/files.before"
ls -1 "$P/node_modules" 2>/dev/null | sort > "$SNAP/nm.before"
ls -1 "$P/.plugin-manager/logs" 2>/dev/null | sort > "$SNAP/logs.before"

say "== 卸载 $PKG（profile=$PROFILE）"
if dsh plugin --profile "$PROFILE" remove "$PKG" > /tmp/ctx-remove.log 2>&1; then
  ok "dsh plugin remove 成功：$(grep -E '^-\s' /tmp/ctx-remove.log | tail -1 | xargs)"
else
  fail "dsh plugin remove 失败"; tail -5 /tmp/ctx-remove.log; exit 1
fi

# 插件在 profile patch 里可能留下自动挂载行（顶层插件行、control 行、preset-standard 整段覆盖）。
# 依赖移除后这些行会引用不存在的包，必须一并清理；脚本自带备份。
say "== 清理 profile patch 里的插件残留行"
CLEAN=/mnt/c/Users/40410/Desktop/context/scripts/clean-ctx-profile-patch.mjs
if [ -f "$CLEAN" ] && node "$CLEAN" "$P"; then
  ok "profile patch 清理完成"
else
  fail "profile patch 清理失败（可手动检查 $P/cordis.patch.yml）"
fi

say "== 核对"
node - "$P" "$PKG" <<'NODE'
const fs = require('fs')
const [dir, pkg] = process.argv.slice(2)
const m = JSON.parse(fs.readFileSync(`${dir}/package.json`, 'utf8'))
const bundles = m.dsh?.profile?.bundles ?? []
const deps = Object.keys(m.dependencies ?? {})
const checks = [
  ['package.json dependencies 不再含该包', !deps.includes(pkg)],
  ['package.json bundles 不再含该包', !bundles.includes(pkg)],
]
for (const [name, passed] of checks) console.log(`${passed ? 'ok  ' : 'FAIL'} - ${name}`)
process.exit(checks.every(([, p]) => p) ? 0 : 1)
NODE
[ $? -eq 0 ] || FAILED=1

# pnpm 在 Linux 上 remove 后可能留下指向插件源码目录的 symlink（Windows 版会删掉 junction）。
# 只删这个指回本仓库插件目录的符号链接，不触碰插件源码。
LINK="$P/node_modules/$PKG"
if [ -L "$LINK" ]; then
  TARGET=$(readlink -f "$LINK")
  case "$TARGET" in
    */dsh-plugins/ctx-mon-and-con)
      rm -f "$LINK"
      ok "移除残留 symlink（-> $TARGET）"
      ;;
    *)
      fail "node_modules/$PKG 是符号链接但指向未知目标：$TARGET"
      ;;
  esac
elif [ -e "$LINK" ]; then
  fail "node_modules/$PKG 是真实目录，需人工确认"
else
  ok "node_modules 无该包"
fi

ROWS=$(dsh --profile "$PROFILE" --dump-config 2>/dev/null | grep -c 'ctx-mon-and-con' || true)
[ "$ROWS" -eq 0 ] && ok "--dump-config 不再出现该行" || fail "--dump-config 仍有 $ROWS 处"

# 残留：装前 vs 卸后
( cd "$P" && find . -maxdepth 1 -type f -printf '%f\n' | sort | while read -r f; do sha256sum "$f"; done ) > "$SNAP/files.after"
ls -1 "$P/node_modules" 2>/dev/null | sort > "$SNAP/nm.after"
ls -1 "$P/.plugin-manager/logs" 2>/dev/null | sort > "$SNAP/logs.after"

say "== 残留报告"
if diff -q "$SNAP/files.before" "$SNAP/files.after" >/dev/null; then
  ok "profile 顶层文件内容未变（装前=卸后）"
else
  say "（以下文件在安装/卸载后发生了变化，属正常：package.json 去掉了依赖、lock 去掉了条目）"
  diff "$SNAP/files.before" "$SNAP/files.after" | sed 's/^/     /'
fi
NEW_NM=$(comm -13 "$SNAP/nm.before" "$SNAP/nm.after" || true)
[ -z "$NEW_NM" ] && ok "node_modules 无新增条目" || fail "node_modules 新增：$NEW_NM"
NEW_LOGS=$(comm -13 "$SNAP/logs.before" "$SNAP/logs.after" || true)
if [ -n "$NEW_LOGS" ]; then
  say "（通用残留）新增管理器日志：$NEW_LOGS —— 任何插件都会留，可手动删除"
else
  ok "无新增管理器日志"
fi

say ""
if [ "$FAILED" -eq 0 ]; then
  say "结论：$PKG 已从 profile $PROFILE 卸载，依赖/bundles/node_modules/组合树均无该插件。"
  say "注意：需重启 dsh 进程后 /ctx 与设置面板才会消失（运行中的进程保留已加载模块）。"
  exit 0
else
  say "结论：存在未通过项，见上面 FAIL。"; exit 1
fi
