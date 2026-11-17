#!/usr/bin/env bash
#
# deploy-plugin.sh — 把源码检出里的 agent-embodiment 同步到已安装副本。
#
# 为什么要有它：每次发版都要往两侧各拷一份（WSL 的 ~/dsh-plugins、Windows 的
# %USERPROFILE%\dsh-plugins），拷错了排除项就会把 test/deps 和 node_modules 一起带过去
# （test/deps 是从 app.asar 解出来的生成物，几十 MB；node_modules 是 oxlint）。
# 以前每轮都是临时写一段脚本，容易漏排除项、也容易被忘掉。
#
# 用法（在 Windows 侧用 wsl 调用，或直接在 WSL 里跑）：
#   bash scripts/deploy-plugin.sh                 # 演练：只打印计划
#   bash scripts/deploy-plugin.sh --apply         # 真拷
#   bash scripts/deploy-plugin.sh --apply --check # 拷完跑 node --check 与 render 测试
#   bash scripts/deploy-plugin.sh --apply --wsl-only
#
# 不做的事：不重启 DSH（重启会换 web 端口、影响你正在用的页面）。需要重启时用
# scripts/restart-desktop-hidden.vbs（见 CLAUDE.md）。
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$REPO_ROOT/agent-embodiment"
WSL_DEST="${HOME}/dsh-plugins/agent-embodiment"

# Windows 侧的用户目录不能用 $USER 猜（WSL 用户名和 Windows 账户名常常不同）。
# 按特征探测：优先「Desktop 下就是本仓库」的那个用户目录，其次第一个有 Desktop 的。
WIN_HOME=""
for candidate in /mnt/c/Users/*; do
  if [ -d "$candidate/Desktop/context/agent-embodiment" ]; then
    WIN_HOME="$candidate"
    break
  fi
done
if [ -z "$WIN_HOME" ]; then
  for candidate in /mnt/c/Users/*; do
    if [ -d "$candidate/Desktop" ]; then
      WIN_HOME="$candidate"
      break
    fi
  done
fi
WIN_DEST="${WIN_HOME:+$WIN_HOME/dsh-plugins/agent-embodiment}"

APPLY=0
CHECK=0
SIDE="both"

for arg in "$@"; do
  case "$arg" in
    --apply) APPLY=1 ;;
    --check) CHECK=1 ;;
    --wsl-only) SIDE="wsl" ;;
    --windows-only) SIDE="windows" ;;
    -h|--help) sed -n '2,30p' "$0"; exit 0 ;;
    *) echo "未知参数：$arg（可用 --apply / --check / --wsl-only / --windows-only）" >&2; exit 2 ;;
  esac
done

if [ ! -d "$SRC" ]; then
  echo "找不到源码目录：$SRC" >&2
  exit 1
fi

VERSION="$(grep -m1 '"version"' "$SRC/package.json" | sed 's/.*: *"\([^"]*\)".*/\1/')"

# 非登录 shell 里 PATH 通常不含 ~/.local/bin，直接用 node 会 command not found。
# 这里显式找一遍，找不到就记下空值，--check 时给出提示而不是假装失败。
NODE_BIN="$(command -v node 2>/dev/null || true)"
if [ -z "$NODE_BIN" ]; then
  for candidate in "$HOME/.local/bin/node" /usr/local/bin/node /usr/bin/node; do
    if [ -x "$candidate" ]; then
      NODE_BIN="$candidate"
      break
    fi
  done
fi
echo "源码：$SRC（版本 $VERSION）"
echo "排除：test/deps  node_modules  .git"
echo

# 排除项只写一处，两个目标共用，避免哪天改了一边漏了另一边。
copy_side() {
  local label="$1" dest="$2"
  if [ -z "$dest" ]; then
    echo "  $label：跳过（没有可用路径）"
    return 0
  fi
  echo "  $label → $dest"
  if [ "$APPLY" -eq 0 ]; then
    echo "    （演练）将删除并重建目标目录后拷入"
    return 0
  fi
  rm -rf "$dest"
  mkdir -p "$(dirname "$dest")"
  cp -a "$SRC" "$dest"
  rm -rf "$dest/test/deps" "$dest/node_modules" "$dest/.git"
  local copied
  copied="$(find "$dest" -type f | wc -l)"
  echo "    完成：$copied 个文件"
}

echo "目标："
[ "$SIDE" = "wsl" ] || [ "$SIDE" = "both" ] && copy_side "WSL" "$WSL_DEST"
[ "$SIDE" = "windows" ] || [ "$SIDE" = "both" ] && copy_side "Windows" "$WIN_DEST"
echo

if [ "$APPLY" -eq 0 ]; then
  echo "这是演练。加 --apply 才会真的拷。"
  exit 0
fi

if [ "$CHECK" -eq 1 ]; then
  echo "校验："
  for dest in "$WSL_DEST" "$WIN_DEST"; do
    [ -d "$dest" ] || continue
    if [ -z "$NODE_BIN" ]; then
      echo "  （跳过 node --check：没找到 node 可执行文件）"
    elif "$NODE_BIN" --check "$dest/index.js" && "$NODE_BIN" --check "$dest/control.js" && "$NODE_BIN" --check "$dest/client.js"; then
      echo "  node --check ✓ $dest"
    else
      echo "  node --check ✗ $dest" >&2
      exit 1
    fi
    echo "  版本：$(grep -m1 '"version"' "$dest/package.json" | sed 's/.*: *"\([^"]*\)".*/\1/')"
  done
  echo
  echo "提示：单元套件依赖仓库布局（test/static.mjs 读 ../../README.md），只能在源码检出里跑；"
  echo "      安装副本里用 node --check 与集成测试验收。"
fi

echo
echo "下一步（需要时）：重启 DSH 让新版本生效，见 CLAUDE.md 的 restart-desktop-hidden.vbs。"