#!/usr/bin/env bash
# Uploads a built site to Cloudflare Pages as a production deployment, tagged
# with the commit it was built from so every live version traces back to a
# reviewed change. Runs in the deploy job after the production approval.
#
#   scripts/deploy-pages.sh [--dry-run] <site-dir>
#
# Requires CLOUDFLARE_API_TOKEN (Pages edit only), CLOUDFLARE_ACCOUNT_ID,
# PAGES_PROJECT_NAME and GITHUB_SHA, plus wrangler installed from
# deploy/package-lock.json.
set -euo pipefail

dry_run=0
if [[ "${1:-}" == "--dry-run" ]]; then
  dry_run=1
  shift
fi
site_dir="${1:?usage: deploy-pages.sh [--dry-run] <site-dir>}"

root="$(cd "$(dirname "$0")/.." && pwd)"
wrangler="$root/deploy/node_modules/.bin/wrangler"

for name in CLOUDFLARE_ACCOUNT_ID PAGES_PROJECT_NAME GITHUB_SHA; do
  if [[ -z "${!name:-}" ]]; then
    echo "deploy-pages: $name is not set" >&2
    exit 2
  fi
done
# Every file the build produces must be here. A step between the build and
# this job once dropped a hidden directory without an error; refuse to upload
# an incomplete site rather than find out from the verify step after it is
# live. The list comes from the build script, so it cannot drift from it.
if ! expected="$(node "$root/scripts/build-site.js" --list)" || [[ -z "$expected" ]]; then
  echo "deploy-pages: could not list the files the build produces" >&2
  exit 2
fi
missing=()
while IFS= read -r file; do
  [[ -f "$site_dir/$file" ]] || missing+=("$file")
done <<< "$expected"
if (( ${#missing[@]} )); then
  echo "deploy-pages: $site_dir is missing ${missing[*]}; not uploading an incomplete site" >&2
  exit 2
fi

commit_message="$(git -C "$root" log -1 --format=%s "$GITHUB_SHA" 2>/dev/null || echo "$GITHUB_SHA")"
command=("$wrangler" pages deploy "$site_dir"
  --project-name "$PAGES_PROJECT_NAME"
  --branch main
  --commit-hash "$GITHUB_SHA"
  --commit-message "$commit_message"
  --commit-dirty=false)

echo "deploy-pages: $(find "$site_dir" -type f | wc -l | tr -d ' ') files from $site_dir to project $PAGES_PROJECT_NAME at ${GITHUB_SHA:0:12}"
if (( dry_run )); then
  printf 'deploy-pages: dry run, would run:'
  printf ' %q' "${command[@]}"
  printf '\n'
  exit 0
fi

if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  echo "deploy-pages: CLOUDFLARE_API_TOKEN is not set" >&2
  exit 2
fi
if [[ ! -x "$wrangler" ]]; then
  echo "deploy-pages: wrangler not installed; run npm ci --ignore-scripts in deploy/" >&2
  exit 2
fi

# Telemetry off: the deploy job sends nothing to Cloudflare beyond the upload.
WRANGLER_SEND_METRICS=false "${command[@]}"
