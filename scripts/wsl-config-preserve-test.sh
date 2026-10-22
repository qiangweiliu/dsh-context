#!/usr/bin/env bash
# 配置保留验证：安装 → 改配置 → remove → 重新 add → update，配置/预设行/会话文件应不变。
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"

P="$HOME/.dsh/profiles"
TEMP="ctxpres"
T="$P/$TEMP"
PATCH="$T/cordis.patch.yml"
SRC="$HOME/dsh-plugins/agent-embodiment"
TOG="$HOME/.dsh/agent-embodiment/session-toggles.json"

rm -rf "$T"
cp -a "$P/web" "$T"
echo "copied profile -> $T"

echo
echo "===== 1. remove + 重新安装（本地路径） ====="
dsh plugin --profile "$TEMP" remove agent-embodiment >/tmp/pres-remove.log 2>&1; echo "remove exit=$?"
dsh plugin --profile "$TEMP" add "$SRC" >/tmp/pres-add.log 2>&1; echo "add exit=$?"
grep -n "agent-embodiment" "$T/package.json" | head -3

echo
echo "===== 2. 写入可识别配置 ====="
python3 - "$PATCH" <<'PY'
import sys, pathlib
p = pathlib.Path(sys.argv[1])
s = p.read_text()
s = s.replace("contextWindowTokens: 128000", "contextWindowTokens: 111000", 1)
s = s.replace("warnAt: 0.75", "warnAt: 0.7", 1)
s = s.replace("errorAt: 0.9", "errorAt: 0.85", 1)
s = s.replace("disabledTools: []", "disabledTools:\n      - bash", 1)
s = s.replace("promptOverrides: {}", "promptOverrides:\n      harness:identity: PRESERVE-TEST", 1)
p.write_text(s)
print("config written")
PY
cp "$PATCH" /tmp/pres-patch-before.yml
HASH_BEFORE=$(sha256sum "$PATCH" | cut -d' ' -f1)
TOG_BEFORE=$(sha256sum "$TOG" 2>/dev/null | cut -d' ' -f1 || echo none)
echo "patch sha=$HASH_BEFORE toggles sha=$TOG_BEFORE"
grep -n -A9 "^- id: agent-embodiment" "$PATCH" | head -12

echo
echo "===== 3. remove + add（模拟更新安装）后对比 ====="
dsh plugin --profile "$TEMP" remove agent-embodiment >/tmp/pres-remove2.log 2>&1; echo "remove2 exit=$?"
dsh plugin --profile "$TEMP" add "$SRC" >/tmp/pres-add2.log 2>&1; echo "add2 exit=$?"
HASH_AFTER=$(sha256sum "$PATCH" | cut -d' ' -f1)
TOG_AFTER=$(sha256sum "$TOG" 2>/dev/null | cut -d' ' -f1 || echo none)
echo "patch unchanged: $([ "$HASH_BEFORE" = "$HASH_AFTER" ] && echo yes || echo NO)"
echo "toggles unchanged: $([ "$TOG_BEFORE" = "$TOG_AFTER" ] && echo yes || echo NO)"
echo "control row kept: $(grep -c 'agent-embodiment-control' "$PATCH")"
echo "config values:"; grep -n -A9 "^- id: agent-embodiment" "$PATCH" | head -12

echo
echo "===== 4. 官方 update 后对比 ====="
dsh plugin --profile "$TEMP" update agent-embodiment >/tmp/pres-upd.log 2>&1; echo "update exit=$?"
HASH_UPDATE=$(sha256sum "$PATCH" | cut -d' ' -f1)
TOG_UPDATE=$(sha256sum "$TOG" 2>/dev/null | cut -d' ' -f1 || echo none)
echo "patch unchanged: $([ "$HASH_BEFORE" = "$HASH_UPDATE" ] && echo yes || echo NO)"
echo "toggles unchanged: $([ "$TOG_BEFORE" = "$TOG_UPDATE" ] && echo yes || echo NO)"
echo "control row kept: $(grep -c 'agent-embodiment-control' "$PATCH")"

echo
echo "===== 5. 清理 ====="
rm -rf "$T"
rm -f /tmp/pres-patch-before.yml
echo cleaned
