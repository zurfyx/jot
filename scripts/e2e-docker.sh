#!/usr/bin/env bash
# Runs Playwright inside the image the e2e CI job uses (same Chromium, fonts and
# architecture), so screenshots taken here match CI's. Arguments go to
# `playwright test`, e.g. `pnpm e2e:docker e2e/visual --update-snapshots`.
#
# The container gets its own node_modules (Linux binaries for workerd and the
# bundler) in a Docker volume named after this checkout, so the host's stays
# untouched and parallel checkouts never share one. It runs as the host's user,
# as CI runs it as the runner's (--user 1001 there), so the baselines and test
# results it writes into the checkout belong to you, not to root.
set -euo pipefail

cd "$(dirname "$0")/.."
image=$(grep -oE 'mcr\.microsoft\.com/playwright:[^ ]+' .github/workflows/ci.yml | head -n 1)
volume="jot-e2e-$(printf '%s' "$PWD" | shasum | cut -c 1-12)"
user="$(id -u):$(id -g)"
volumes=(-v "$volume":/work/node_modules -v jot-e2e-pnpm-store:/pnpm-store -v jot-e2e-corepack:/corepack)

# CI runs on x86-64 runners; emulate it on Apple silicon so pixels agree.
platform=(--platform linux/amd64)

# Docker creates named volumes owned by root: hand them to the user once.
docker run --rm "${platform[@]}" "${volumes[@]}" "$image" sh -c '
  for dir in /work/node_modules /pnpm-store /corepack; do
    [ "$(stat -c %u:%g "$dir")" = "$1" ] || chown -R "$1" "$dir"
  done
' chown "$user"

exec docker run --rm --init --ipc=host "${platform[@]}" --user "$user" \
  -v "$PWD":/work "${volumes[@]}" -w /work \
  -e HOME=/tmp -e COREPACK_HOME=/corepack -e COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
  -e CI -e JOT_E2E_PORT -e JOT_E2E_WORKERS -e JOT_E2E_VISUAL=1 \
  "$image" bash -c '
    set -e
    # pnpm on the PATH (the webServer command calls it), without root.
    mkdir -p /tmp/bin && corepack enable pnpm --install-directory /tmp/bin
    export PATH="/tmp/bin:$PATH"
    pnpm install --frozen-lockfile --reporter=silent --config.store-dir=/pnpm-store
    exec pnpm exec playwright test "$@"
  ' playwright "$@"
