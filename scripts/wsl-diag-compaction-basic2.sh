#!/usr/bin/env bash
set -uo pipefail
B=$HOME/.local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-compaction-basic/lib/index.js
echo "===== 阈值函数 (100-170) ====="
sed -n '100,170p' "$B"
echo
echo "===== compactIfNeeded 主体 (914-1000) ====="
sed -n '914,1005p' "$B"
