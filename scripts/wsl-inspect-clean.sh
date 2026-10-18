#!/usr/bin/env bash
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
P="$HOME/.dsh/profiles/web"
echo "=== original lines 36-54 ==="
sed -n '36,54p' "$P/cordis.patch.yml" | cat -A | head -30
echo "=== cleaned tail structure ==="
sed -n '36,44p' /tmp/ctx-patch-test.yml
echo "=== python yaml parse ==="
python3 - <<'PY'
import yaml, sys
try:
    with open('/tmp/ctx-patch-test.yml') as f:
        data = yaml.safe_load(f)
    ids = [e.get('id') for e in data if isinstance(e, dict)]
    print('ok, entries:', len(data), 'ids:', ids)
except Exception as e:
    print('YAML ERROR:', e)
    sys.exit(1)
PY
echo "=== original yaml parse ==="
python3 - <<'PY'
import yaml
with open('/home/wu/.dsh/profiles/web/cordis.patch.yml') as f:
    data = yaml.safe_load(f)
ids=[e.get('id') for e in data if isinstance(e,dict)]
print('ok, entries:', len(data), 'ids:', ids)
PY
