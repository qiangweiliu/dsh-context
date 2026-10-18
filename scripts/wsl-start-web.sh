#!/usr/bin/env bash
# 启动 WSL 里的 dsh web profile（无头），等待就绪并打印带 token 的 URL。
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
PORT="${1:-3080}"
LOG=/tmp/ctx-ui-version.log
# 清掉旧的测试实例（本脚本只用于本地验证，会占用 $PORT）
pkill -f "dsh.*--profile web" >/dev/null 2>&1 || true
pkill -f "/dsh web$" >/dev/null 2>&1 || true
sleep 1
if command -v fuser >/dev/null 2>&1; then fuser -k "${PORT}/tcp" >/dev/null 2>&1 || true; fi
sleep 1
cd "$HOME"
setsid nohup dsh --profile web > "$LOG" 2>&1 < /dev/null &
for i in $(seq 1 60); do
  if grep -q "token=" "$LOG" 2>/dev/null; then break; fi
  sleep 1
done
TOKEN=$(grep -o 'token=[A-Za-z0-9_-]*' "$LOG" | head -1 | cut -d= -f2)
if [ -z "$TOKEN" ]; then
  echo "FAIL - no token in log"; tail -20 "$LOG"; exit 1
fi
# 等 HTTP 可用
for i in $(seq 1 30); do
  code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/?token=$TOKEN" || true)
  [ "$code" = "200" ] && break
  sleep 1
done
echo "URL=http://127.0.0.1:$PORT/?token=$TOKEN"
echo "LOG=$LOG"
