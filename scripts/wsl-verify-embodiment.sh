#!/usr/bin/env bash
# 只做校验：WSL web profile 里的 agent-embodiment 版本/安装组合/静态测试/进程。
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
P="$HOME/.dsh/profiles/web"
DEST="$HOME/dsh-plugins/agent-embodiment"

echo "== profile: $P"
if [ -f "$P/node_modules/agent-embodiment/package.json" ]; then
  node -e "console.log('installed version:', require('$P/node_modules/agent-embodiment/package.json').version)"
else
  echo "installed: missing"
fi
if [ -f "$DEST/package.json" ]; then
  node -e "console.log('source version:  ', require('$DEST/package.json').version)"
  ( cd "$DEST" && node test/static.mjs 2>&1 | tail -1 )
fi
node -e "
const p=require('$P/package.json');
const b=(p.dsh&&p.dsh.profile&&p.dsh.profile.bundles)||[];
const d=Object.keys(p.dependencies||{});
console.log('bundles has plugin:', b.includes('agent-embodiment'));
console.log('deps has plugin:   ', d.includes('agent-embodiment'));
console.log('dep spec:          ', p.dependencies&&p.dependencies['agent-embodiment']);
"
echo "== dsh web 进程:"
pgrep -af 'dsh --profile web' || echo 'none'
