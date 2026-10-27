#!/usr/bin/env bash
# Runs Playwright inside the image the e2e CI job uses (same Chromium, fonts and
# architecture), so screenshots taken here match CI's. Arguments go to
# `playwright test`, e.g. `pnpm e2e:docker e2e/visual --update-snapshots`.
#
# The container gets its own node_modules (Linux binaries for workerd and the
# bundler) in a Docker volume named after this checkout, so the host's stays
# untouched and parallel checkouts never share one.
set -euo pipefail

cd "$(dirname "$0")/.."
image=$(grep -oE 'mcr\.microsoft\.com/playwright:[^ ]+' .github/workflows/ci.yml | head -n 1)
volume="jot-e2e-$(printf '%s' "$PWD" | shasum | cut -c 1-12)"

# CI runs on x86-64 runners; emulate it on Apple silicon so pixels agree.
exec docker run --rm --init --ipc=host --platform linux/amd64 \
  -v "$PWD":/work -v "$volume":/work/node_modules -v jot-e2e-pnpm-store:/pnpm-store -v jot-e2e-corepack:/root/.cache/node/corepack \
  -w /work -e CI -e JOT_E2E_PORT -e JOT_E2E_WORKERS -e JOT_E2E_VISUAL=1 \
  "$image" bash -c '
    set -e
    corepack enable >/dev/null 2>&1
    export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
    pnpm config set store-dir /pnpm-store >/dev/null
    pnpm install --frozen-lockfile --reporter=silent
    exec pnpm exec playwright test "$@"
  ' playwright "$@"
