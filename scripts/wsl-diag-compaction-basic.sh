#!/usr/bin/env bash
set -uo pipefail
B=$HOME/.local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-compaction-basic
echo "===== 文件 ====="
ls "$B/lib" 2>/dev/null
echo
echo "===== compactIfNeeded 实现 ====="
grep -n -A60 "compactIfNeeded" "$B/lib/index.js" | head -90
echo
echo "===== 阈值相关配置字段 ====="
grep -n -E "thresholdRatio|retainRatio|headroom|targetRatio|maxTokens|modelPolicies" "$B/lib/index.js" | head -30
