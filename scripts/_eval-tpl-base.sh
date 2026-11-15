#!/usr/bin/env bash
# 模板转正第一部分：先确认 base 在这些定向题上会失败（否则题目没有区分度）。
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"

CRED="$HOME/.dsh/.credentials.yaml"
KEY=$(node -e '
const fs=require("fs");
const text=fs.readFileSync(process.argv[1],"utf8");
const m=/^\s*OPENCODE_GO_API_KEY:\s*"?([^"\n]+)"?/mu.exec(text);
process.stdout.write(m?m[1].trim():"");
' "$CRED")
[ -z "$KEY" ] && { echo "FAIL: 没有 OPENCODE_GO_API_KEY"; exit 1; }
export OPENCODE_GO_API_KEY="$KEY"

ROOT="$HOME/.cache/embody-eval"
cd /mnt/c/Users/40410/Desktop/context || exit 1
mkdir -p eval/results/template-hard

echo "=== base 在 6 道定向题上的表现（应有多题失败）==="
node eval/deep/run.mjs \
  --questions eval/deep/questions-templates.jsonl \
  --condition base \
  --ds-home "$ROOT/base-home" \
  --workers 1 --timeout 600 \
  --out eval/results/template-hard/base.jsonl 2>&1 | tail -30
