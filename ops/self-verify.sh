#!/usr/bin/env bash
# Nightforge self-release gate: verifies the staged release is bootable
# WITHOUT touching the live service. The live process keeps serving from
# the previous release; activation is the watchdog's job.
set -euo pipefail

ROOT="${NIGHTFORGE_RUNTIME_ROOT:-/opt/nightforge/projects}"
RELEASE="$(readlink -f "$ROOT/current")"

test -f "$RELEASE/dist/main.js"
node --check "$RELEASE/dist/main.js"
node --check "$RELEASE/dist/server.js"
node --check "$RELEASE/dist/cli/diagnostics.js"
node -e "JSON.parse(require('fs').readFileSync('$RELEASE/package.json', 'utf8'))"

echo "self-verify ok: $RELEASE"
