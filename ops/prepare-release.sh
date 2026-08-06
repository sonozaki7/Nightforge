#!/usr/bin/env bash
# Nightforge self-release: prepares the staged release directory.
# Contract: runs with cwd = the new release dir (deployer.deploy).
# Installs runtime deps and marks the release pending. The external
# watchdog (root-owned systemd timer) performs the actual service
# restart — Nightforge never restarts itself.
set -euo pipefail

npm ci --omit=dev --no-audit --no-fund

ROOT="${NIGHTFORGE_RUNTIME_ROOT:-/opt/nightforge/projects}"
# The marker names this release so the watchdog swaps `current` to it.
basename "$(pwd)" >"$ROOT/.pending-activation"

echo "release prepared: $(pwd)"
