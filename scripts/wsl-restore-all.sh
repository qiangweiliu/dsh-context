#!/usr/bin/env bash
# 一键还原：备份当前状态 -> 卸载插件 -> 从 profile patch 移除 ctx 配置行与 preset 控制行 -> 删除会话数据文件。
# 用法：wsl.exe -d Ubuntu-24.04 -e bash /mnt/c/.../scripts/wsl-restore-all.sh [profile]
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"

PROFILE="${1:-web}"
P="$HOME/.dsh/profiles/$PROFILE"
PATCH="$P/cordis.patch.yml"
DATA_DIR="$HOME/.dsh/ctx-mon-and-con"
SESSION_FILE="$DATA_DIR/session-toggles.json"
BACKUP_DIR="$DATA_DIR/backups"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)

say() { printf '%s\n' "$*"; }

[ -d "$P" ] || { say "找不到 profile：$P"; exit 1; }

say "== 1. 备份当前状态到 $BACKUP_DIR"
mkdir -p "$BACKUP_DIR"
[ -f "$PATCH" ] && cp -a "$PATCH" "$BACKUP_DIR/cordis.patch.restore-$STAMP.bak" && say "backed up patch"
[ -f "$SESSION_FILE" ] && cp -a "$SESSION_FILE" "$BACKUP_DIR/session-toggles.restore-$STAMP.bak" && say "backed up session file"

say "== 2. 卸载插件（如果已安装）"
if grep -q '"ctx-mon-and-con"' "$P/package.json" 2>/dev/null; then
  dsh plugin --profile "$PROFILE" remove ctx-mon-and-con >/tmp/restore-remove.log 2>&1
  say "remove exit=$?"
else
  say "插件未安装，跳过卸载"
fi

say "== 3. 从 cordis.patch.yml 移除 ctx 配置行与 preset 控制行"
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
  // 顶层 ctx 配置行：- id: ctx-mon-and-con
  if (/^- id: ctx-mon-and-con\s*$/.test(line)) {
    changed = true
    i += 1
    while (i < lines.length && !/^- /.test(lines[i])) i += 1
    continue
  }
  // preset 内控制行：缩进的 - id: ctx-mon-and-con-control
  const m = /^(\s+)- id: ctx-mon-and-con-control\s*$/.exec(line)
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
if (changed) {
  fs.writeFileSync(file, out.join('\n'))
  console.log('patch cleaned')
} else {
  console.log('nothing to clean in patch')
}
NODE
say "patch cleaned exit=$?"

say "== 4. 删除会话数据文件（已备份）"
rm -f "$SESSION_FILE" && say "removed session-toggles.json"

say "== 5. 核对残留"
LEFT=$(grep -c "ctx-mon-and-con" "$PATCH" 2>/dev/null || true)
say "patch 中 ctx-mon-and-con 出现次数：${LEFT:-0}"
grep -n "ctx-mon-and-con" "$P/package.json" 2>/dev/null || say "profile package.json 无引用"
say "备份保留在：$BACKUP_DIR"
say "如需恢复备份：cp $BACKUP_DIR/cordis.patch.restore-$STAMP.bak $PATCH"
