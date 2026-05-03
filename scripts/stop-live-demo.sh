#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="$ROOT_DIR/.agentslam-run"
BACKEND_PORT="${BACKEND_PORT:-8787}"
FRONTEND_PORT="${FRONTEND_PORT:-3000}"

log() {
  printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*"
}

kill_pid_file() {
  local file="$1"
  if [[ -f "$file" ]]; then
    local pid
    pid="$(cat "$file")"
    if [[ -n "$pid" ]] && kill -0 "$pid" >/dev/null 2>&1; then
      log "Stopping PID $pid from ${file#$ROOT_DIR/}"
      kill -- "-$pid" >/dev/null 2>&1 || kill "$pid" >/dev/null 2>&1 || true
    fi
    rm -f "$file"
  fi
}

stop_port() {
  local port="$1"
  if command -v fuser >/dev/null 2>&1 && fuser "${port}/tcp" >/dev/null 2>&1; then
    log "Stopping process on port $port"
    fuser -k "${port}/tcp" >/dev/null 2>&1 || true
  fi
}

kill_pid_file "$RUN_DIR/backend.pid"
kill_pid_file "$RUN_DIR/frontend.pid"
sleep 1
stop_port "$BACKEND_PORT"
stop_port "$FRONTEND_PORT"

log "Local Agent Slam demo servers stopped"
log "PostgreSQL container is left running. To stop it: cd backend && docker compose down"
