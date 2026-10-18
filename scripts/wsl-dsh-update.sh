#!/usr/bin/env bash
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
echo "== latest available =="
timeout 60 npm view @deepseek-ai/dsh version 2>&1 | tail -2
echo "== current =="
dsh --version 2>&1 | head -1
echo "== updating to latest =="
timeout 600 npm install -g @deepseek-ai/dsh@latest >/tmp/dsh-update.log 2>&1
echo "npm exit=$?"
tail -6 /tmp/dsh-update.log
echo "== after =="
dsh --version 2>&1 | head -1
grep -m1 '"version"' "$HOME/.local/lib/node_modules/@deepseek-ai/dsh/package.json" 2>/dev/null
