#!/usr/bin/env bash
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
NM="$HOME/.dsh/profiles/web/node_modules"
echo "== 相关包 =="
ls -1 "$NM" 2>/dev/null | grep -Ei 'context|token|usage|ctx|budget|meter|compact' | head -30
for pkg in dsh-context dsh-token-monitor; do
  P=$(readlink -f "$NM/$pkg" 2>/dev/null || true)
  [ -n "$P" ] || continue
  echo "== $pkg -> $P"
  find "$P" -maxdepth 2 -type f -printf '%P\n' | head -40
  node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('$P/package.json','utf8'));console.log(JSON.stringify({name:p.name,version:p.version,dsh:p.dsh,files:p.files},null,1))"
done
