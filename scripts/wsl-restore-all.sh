!/usr/bin/env bash
# 一键还原（默认只预览+备份；加 --yes 并输入 RESTORE 才真正执行）。
# 用法：
#   wsl.exe -d Ubuntu-24.04 -e bash /mnt/c/.../scripts/wsl-restore-all.sh [profile]            # 预览
#   printf 'RESTORE\n' | .../wsl-restore-all.sh [profile] --yes                                 # 执行
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"

PROFILE=""
YES=0
for arg in "$@"; do
  case "$arg" in
    --yes) YES=1 ;;
    -h|--help) echo "usage: $0 [profile] [--yes]"; exit 0 ;;
    *) PROFILE="$arg" ;;
  esac
done
PROFILE="${PROFILE:-web}"

P="$HOME/.dsh/profiles/$PROFILE"
PATCH="$P/cordis.patch.yml"
DATA_DIR="$HOME/.dsh/agent-embodiment"
SESSION_FILE="$DATA_DIR/session-toggles.json"
BACKUP_DIR="$DATA_DIR/backups"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)

say() { printf '%s\n' "$*"; }

[ -d "$P" ] || { say "找不到 profile：$P"; exit 1; }

# ---------- 预览 ----------
say "== 还原预览（profile: $PROFILE）=="
INSTALLED=no
grep -q '"agent-embodiment"' "$P/package.json" 2>/dev/null && INSTALLED=yes
CTX_REFS=$(grep -c "agent-embodiment" "$PATCH" 2>/dev/null || true)
CTX_REFS=${CTX_REFS:-0}
CONTROL_ROWS=$(grep -c "id: agent-embodiment-control" "$PATCH" 2>/dev/null || true)
CONTROL_ROWS=${CONTROL_ROWS:-0}
SESSION_DESC="不存在"
if [ -f "$SESSION_FILE" ]; then SESSION_DESC="存在（$(wc -c < "$SESSION_FILE") bytes）"; fi
BACKUP_DESC="不存在"
if [ -d "$BACKUP_DIR" ]; then BACKUP_DESC="$(ls -1 "$BACKUP_DIR" | wc -l) 份，$(du -sh "$BACKUP_DIR" 2>/dev/null | cut -f1)"; fi

say "  插件已安装:        $INSTALLED"
say "  patch 中 ctx 引用:  $CTX_REFS 处（含控制行 $CONTROL_ROWS 行）"
say "  会话数据文件:      $SESSION_DESC"
say "  自动备份目录:      $BACKUP_DESC"
say
say "将要执行的操作："
say "  1) 备份当前 patch 与会话文件到 $BACKUP_DIR"
say "  2) dsh plugin --profile $PROFILE remove agent-embodiment"
say "  3) 从 patch 删除 ctx 配置行与控制行（预计删 $CTX_REFS 处引用）"
say "  4) 删除 $SESSION_FILE"
say "  5) 删除备份目录与数据目录（$DATA_DIR）——还原后不再占用空间"
say

# 预览模式：只备份，不动任何东西
mkdir -p "$BACKUP_DIR"
[ -f "$PATCH" ] && cp -a "$PATCH" "$BACKUP_DIR/cordis.patch.restore-$STAMP.bak" && say "已备份 patch -> $BACKUP_DIR/cordis.patch.restore-$STAMP.bak"
[ -f "$SESSION_FILE" ] && cp -a "$SESSION_FILE" "$BACKUP_DIR/session-toggles.restore-$STAMP.bak" && say "已备份会话文件 -> $BACKUP_DIR/session-toggles.restore-$STAMP.bak"

if [ "$YES" -ne 1 ]; then
  say
  say "预览结束：未做任何修改。"
  say "确认要还原请输入 RESTORE 并加 --yes 重新执行，例如："
  say "  printf 'RESTORE\\n' | bash $0 $PROFILE --yes"
  exit 0
fi

say
say "== 二次确认：请输入 RESTORE 后回车 =="
read -r CONFIRM || CONFIRM=""
if [ "$CONFIRM" != "RESTORE" ]; then
  say "确认词不匹配（收到：'${CONFIRM}'），已取消，未做任何修改。"
  exit 1
fi

# ---------- 执行 ----------
say "== 1. 卸载插件 =="
if [ "$INSTALLED" = yes ]; then
  dsh plugin --profile "$PROFILE" remove agent-embodiment >/tmp/restore-remove.log 2>&1
  say "remove exit=$?"
else
  say "插件未安装，跳过"
fi

say "== 2. 清理 patch 行 =="
node - "$PATCH" <<'NODE'
const fs = require('fs')
const file = process.argv[2]
if (!fs.existsSync(file)) { console.log('patch not found, skip'); process.exit(0) }
const lines = fs.readFileSync(file, 'utf8').split('\n')
const out = []
let i = 0
let changed = false
while (i < lines.length) {
  const line = lines[i]
  if (/^- id: agent-embodiment\s*$/.test(line)) {
    changed = true
    i += 1
    while (i < lines.length && !/^- /.test(lines[i])) i += 1
    continue
  }
  const m = /^(\s+)- id: agent-embodiment-control\s*$/.exec(line)
  if (m) {
    changed = true
    const indent = m[1].length
    i += 1
    while (i < lines.length) {
      const next = lines[i]
      if (next.trim() === '') { i += 1; continue }
      const nextIndent = next.length - next.trimStart().length
      if (nextIndent <= indent) break
      i += 1
    }
    continue
  }
  out.push(line)
  i += 1
}
if (changed) { fs.writeFileSync(file, out.join('\n')); console.log('patch cleaned') } else console.log('nothing to clean')
NODE

say "== 3. 删除会话数据与备份目录 =="
rm -f "$SESSION_FILE"
rm -rf "$DATA_DIR"
say "removed $DATA_DIR（含备份）"

say "== 4. 核对 =="
LEFT=$(grep -c "agent-embodiment" "$PATCH" 2>/dev/null || true)
say "patch 中 agent-embodiment 引用：${LEFT:-0}"
grep -n "agent-embodiment" "$P/package.json" 2>/dev/null || say "profile package.json 无引用"
say "还原完成。备份已随数据目录一起删除（按你的要求不再占用空间）。"
