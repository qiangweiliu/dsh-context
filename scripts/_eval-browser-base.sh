#!/usr/bin/env bash
# 加固后：先用 base 复测浏览器 3 题，确认有区分度。
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

node eval/deep/run.mjs \
  --questions eval/deep/questions-templates.jsonl \
  --condition base \
  --ds-home "$ROOT/base-home" \
  --ids tpl-browser-01,tpl-browser-02,tpl-browser-03 \
  --workers 1 --timeout 600 \
  --out eval/results/template-hard/base-browser2.jsonl 2>&1 | tail -20
