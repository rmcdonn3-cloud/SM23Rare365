#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PORT="${PORT:-3000}"

if ! command -v ngrok >/dev/null 2>&1; then
  echo "ngrok is not installed. Install it first: https://ngrok.com/download"
  exit 1
fi

if [ -f ".env" ]; then
  # shellcheck disable=SC2046
  export $(grep -v '^#' .env | xargs)
fi

if [ -n "${NGROK_AUTHTOKEN:-}" ]; then
  ngrok config add-authtoken "$NGROK_AUTHTOKEN" >/dev/null 2>&1 || true
fi

echo "Starting ngrok tunnel on port ${PORT}..."
ngrok http "$PORT" >/tmp/rare360-ngrok.log 2>&1 &
NGROK_PID=$!

cleanup() {
  if kill -0 "$NGROK_PID" >/dev/null 2>&1; then
    kill "$NGROK_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

PUBLIC_URL=""
for _ in $(seq 1 30); do
  PUBLIC_URL="$(curl -s http://127.0.0.1:4040/api/tunnels | sed -n 's/.*\"public_url\":\"\\([^\"]*\\)\".*/\\1/p' | head -n1)"
  if [ -n "$PUBLIC_URL" ]; then
    break
  fi
  sleep 1
done

if [ -z "$PUBLIC_URL" ]; then
  echo "Could not read ngrok public URL from http://127.0.0.1:4040/api/tunnels"
  echo "Check /tmp/rare360-ngrok.log for details."
  exit 1
fi

export APP_BASE_URL="$PUBLIC_URL"
export PORT

echo "Rare360 public URL: ${APP_BASE_URL}"
echo "Starting app server..."
node server.js
