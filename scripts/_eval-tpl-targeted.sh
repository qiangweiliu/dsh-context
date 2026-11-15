#!/usr/bin/env bash
# 模板转正：每个模板只跑与它定位匹配的题。
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

run_one() {
  local template="$1"
  local ids="$2"
  local home="$ROOT/tpl-$template"
  echo "=== $template ← $ids ==="
  rm -rf "$home"
  node scripts/agent-scaffold.mjs --template "$template" --out "$home" --slug "$template" >/dev/null 2>&1 || { echo "脚手架生成失败"; return 1; }
  node eval/deep/run.mjs \
    --questions eval/deep/questions-templates.jsonl \
    --condition scaffold \
    --scaffold-home "$home" \
    --ds-home "$ROOT/plugin-home" \
    --ids "$ids" \
    --workers 1 --timeout 600 \
    --out "eval/results/template-hard/$template.jsonl" 2>&1 | tail -12
}

run_one ops-runbook tpl-ops-01,tpl-ops-02,tpl-ops-03
run_one browser-operator tpl-browser-01,tpl-browser-02,tpl-browser-03
