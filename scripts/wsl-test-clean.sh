#!/usr/bin/env bash
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
P="$HOME/.dsh/profiles/web"
cp "$P/cordis.patch.yml" /tmp/ctx-patch-test.yml
before=$(grep -c 'ctx-mon-and-con' /tmp/ctx-patch-test.yml || true)
node /mnt/c/Users/40410/Desktop/context/scripts/clean-ctx-profile-patch.mjs /tmp/ctx-patch-test.yml
after=$(grep -c 'ctx-mon-and-con' /tmp/ctx-patch-test.yml || true)
echo "ctx rows before=$before after=$after"
echo "--- remaining top-level ids ---"
grep -n '^- id:' /tmp/ctx-patch-test.yml | head -20
echo "--- diff summary ---"
diff "$P/cordis.patch.yml" /tmp/ctx-patch-test.yml | head -20
