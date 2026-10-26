#!/usr/bin/env bash
# Deletes PR <number>'s preview Worker, jot-pr-<number>, and marks its sticky
# comment as removed (D10). Run by preview-cleanup.yml from main's checkout,
# after `pnpm install`:
#
#   scripts/remove-preview.sh <pr-number>
#
# Needs CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, GH_TOKEN and GH_REPO.
set -euo pipefail

pr="${1:-}"
if ! [[ "$pr" =~ ^[0-9]+$ ]]; then
  echo "usage: $0 <pr-number>" >&2
  exit 2
fi
worker="jot-pr-$pr"
wrangler="$(cd "$(dirname "$0")/.." && pwd)/node_modules/.bin/wrangler"

# Run outside the checkout, where no wrangler config can be found, so the
# Worker name comes from --name alone and can never fall back to `jot`.
if out=$(cd "${RUNNER_TEMP:-/tmp}" && "$wrangler" delete --name "$worker" --force 2>&1); then
  echo "$out"
  echo "Deleted $worker."
elif grep -q 'code: 10090' <<< "$out"; then
  # 10090: no such Worker (the PR never deployed one, or it is already gone).
  echo "$worker does not exist; nothing to delete."
else
  echo "$out" >&2
  exit 1
fi

marker='<!-- jot-preview -->'
id=$(gh api "repos/$GH_REPO/issues/$pr/comments" --paginate \
  --jq ".[] | select(.user.login == \"github-actions[bot]\" and (.body | startswith(\"$marker\"))) | .id" |
  head -n1)
if [ -n "$id" ]; then
  body="$marker
**Preview:** removed. Worker \`$worker\` and its notes were deleted when this PR closed."
  gh api -X PATCH "repos/$GH_REPO/issues/comments/$id" -f body="$body" > /dev/null
fi
