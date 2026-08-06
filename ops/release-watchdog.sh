#!/usr/bin/env bash
# Nightforge release watchdog — runs OUTSIDE Nightforge (root systemd timer).
#
# Nightforge can stage a new release of itself, but it must never restart
# itself: a bad release could kill the only system able to fix it. This
# watchdog owns the dangerous steps:
#
#   1. Activate: when a release is pending, wait for workers to drain,
#      restart the service onto the new release, verify health.
#   2. Revive: if the new release fails health (or the service is down
#      and unhealthy), revert the `current` symlink to the last known-good
#      release and restart. Broken code can never strand the system.
set -uo pipefail

ROOT="${NIGHTFORGE_RUNTIME_ROOT:-/opt/nightforge/projects}"
CURRENT="$ROOT/current"
PENDING="$ROOT/.pending-activation"
LAST_GOOD="$ROOT/.last-good-release"
INCIDENTS="$ROOT/incidents"
HEALTH_URL="http://127.0.0.1:3000/health"
QUEUE_ACTIVE_KEY="bull:nightforge-tickets:active"

log() { logger -t nightforge-watchdog "$1"; }

health_ok() { curl -sf -m 5 "$HEALTH_URL" >/dev/null 2>&1; }

active_workers() { redis-cli LLEN "$QUEUE_ACTIVE_KEY" 2>/dev/null || echo 1; }

restart_and_wait() {
  systemctl restart nightforge
  for _ in $(seq 1 12); do
    sleep 5
    if health_ok; then return 0; fi
  done
  return 1
}

previous_release() {
  local current_name releases prev=""
  current_name="$(basename "$(readlink -f "$CURRENT")")"
  releases="$(ls -1 "$ROOT/releases" 2>/dev/null | sort)"
  for r in $releases; do
    if [ "$r" = "$current_name" ]; then
      echo "$prev"
      return
    fi
    prev="$r"
  done
  echo ""
}

revert_to_good() {
  local reason="$1" target=""
  if [ -s "$LAST_GOOD" ]; then
    target="$(cat "$LAST_GOOD")"
  else
    target="$(previous_release)"
  fi
  if [ -z "$target" ] || [ ! -d "$ROOT/releases/$target" ]; then
    log "no known-good release to revert to"
    return 1
  fi
  mkdir -p "$INCIDENTS"
  echo "$(date -u +%FT%TZ) reverted to $target: $reason" >>"$INCIDENTS/watchdog.log"
  ln -sfn "$ROOT/releases/$target" "$CURRENT"
  systemctl restart nightforge
  log "reverted current -> $target ($reason)"
}

# --- Case 1: a release was staged by the pipeline -> activate it.
if [ -f "$PENDING" ]; then
  # The marker names the staged release (written by prepare-release.sh).
  target="$(tr -d '[:space:]' <"$PENDING")"
  if [ -z "$target" ] || [ ! -d "$ROOT/releases/$target" ]; then
    # Legacy/empty marker: assume the newest staged release.
    target="$(ls -1 "$ROOT/releases" 2>/dev/null | sort | tail -n 1)"
  fi
  if [ -z "$target" ] || [ ! -d "$ROOT/releases/$target" ]; then
    log "pending marker present but no release directory found — removing marker"
    rm -f "$PENDING"
    exit 0
  fi

  # Never restart while workers are mid-ticket. The timer re-runs soon.
  if [ "$(active_workers)" != "0" ]; then
    log "pending release $target waiting for workers to drain"
    exit 0
  fi

  # Point current at the staged release BEFORE restarting, otherwise the
  # service boots from the old release and the new code never goes live.
  ln -sfn "$ROOT/releases/$target" "$CURRENT"

  if restart_and_wait; then
    echo "$target" >"$LAST_GOOD"
    rm -f "$PENDING"
    log "activated release $target"
  else
    log "release $target failed health after restart — reverting"
    revert_to_good "release $target failed post-restart health"
    rm -f "$PENDING"
  fi
  exit 0
fi

# --- Case 2: no pending release, but the service is unhealthy -> revive.
if ! health_ok; then
  sleep 15
  if health_ok; then exit 0; fi
  if systemctl is-active --quiet nightforge; then
    revert_to_good "service active but unhealthy"
  else
    revert_to_good "service down"
  fi
fi
exit 0
