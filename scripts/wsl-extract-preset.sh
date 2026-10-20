#!/usr/bin/env bash
# 从 web profile 的组合配置里抽出 preset-registry + preset-standard，做成 headless 可用的 patch。
set -euo pipefail
export PATH=$HOME/.local/bin:$PATH
DUMP=$(mktemp)
dsh --profile web --dump-config > "$DUMP" 2>/dev/null
OUT=${1:-/tmp/preset-standard.yml}

python3 - "$DUMP" "$OUT" <<'PY'
import re, sys
src, out = sys.argv[1], sys.argv[2]
lines = open(src, encoding='utf-8').read().split('\n')

def slice_entry(entry_id):
    start = None
    for i, line in enumerate(lines):
        if line.strip() == f'- id: {entry_id}':
            start = i
            break
    if start is None:
        raise SystemExit(f'找不到 {entry_id}')
    end = start + 1
    while end < len(lines) and not lines[end].startswith('- '):
        end += 1
    return lines[start:end]

blocks = []
for entry_id in ('agent-preset-registry', 'preset-standard'):
    blocks.extend(slice_entry(entry_id))
open(out, 'w', encoding='utf-8').write('\n'.join(blocks).rstrip() + '\n')
print(f'wrote {out}: {len(blocks)} 行')
PY

rm -f "$DUMP"
