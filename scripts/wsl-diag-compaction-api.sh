#!/usr/bin/env bash
set -uo pipefail
C=$HOME/.local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-compaction

echo "===== 1. 类型声明里的 API ====="
grep -n -E "compactIfNeeded|compactNow|threshold|target" "$C/lib/types/index.d.ts" 2>/dev/null | head -40

echo
echo "===== 2. README 里的阈值/触发说明 ====="
grep -n -i -E "compactIfNeeded|threshold|budget|pressure" "$C/README.md" 2>/dev/null | head -30

echo
echo "===== 3. 实现里 compactIfNeeded 的函数体（前 80 行） ====="
LINE=$(grep -n "async compactIfNeeded" "$C/lib/index.js" | head -1 | cut -d: -f1)
echo "line=$LINE"
if [ -n "${LINE:-}" ]; then sed -n "${LINE},$((LINE+70))p" "$C/lib/index.js"; fi
