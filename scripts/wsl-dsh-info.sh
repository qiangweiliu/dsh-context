#!/usr/bin/env bash
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
echo "== which dsh =="
which dsh || true
readlink -f "$(which dsh 2>/dev/null)" 2>/dev/null || true
echo "== version =="
dsh --version 2>&1 | head -5 || true
echo "== npm global =="
npm ls -g --depth=0 2>/dev/null | head -15 || true
echo "== pnpm global =="
pnpm ls -g --depth=0 2>/dev/null | head -10 || true
echo "== dsh dir =="
ls -d "$HOME/.local/lib/node_modules/@deepseek-ai/dsh" 2>/dev/null || true
grep -m1 '"version"' "$HOME/.local/lib/node_modules/@deepseek-ai/dsh/package.json" 2>/dev/null || true
