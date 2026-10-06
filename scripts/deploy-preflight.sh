#!/usr/bin/env bash
# Checks, in the build job, everything the deploy needs that the build job can
# see, so a deploy that cannot succeed fails before it asks for a production
# approval. Missing variables usually mean the terraform/github apply that
# creates them has not run yet.
#
# The Cloudflare token is a production environment secret, which only the
# approved deploy job can read; deploy-pages.sh checks it there.
#
# The deploy job runs this again with EXPECTED_CLOUDFLARE_ACCOUNT_ID and
# EXPECTED_PAGES_PROJECT_NAME set to what the build job checked. A production
# environment variable of the same name would override the repository value
# in the deploy job only, so a mismatch fails the deploy before any upload.
set -euo pipefail

failures=0
check() {
  local name="$1" pattern="$2" hint="$3"
  local value="${!name:-}"
  if [[ -z "$value" ]]; then
    echo "deploy-preflight: $name is not set. $hint" >&2
    failures=$((failures + 1))
  elif [[ ! "$value" =~ $pattern ]]; then
    echo "deploy-preflight: $name is set but malformed. $hint" >&2
    failures=$((failures + 1))
  else
    echo "deploy-preflight: ok   $name"
  fi
}

# Same patterns as the validation blocks on cloudflare_account_id and
# pages_project_name in terraform/github/variables.tf; change both together.
hint="It is a repository variable managed in terraform/github; confirm that workspace's latest apply."
check CLOUDFLARE_ACCOUNT_ID '^[0-9a-f]{32}$' "$hint"
check PAGES_PROJECT_NAME '^[a-z0-9][a-z0-9-]{0,56}[a-z0-9]$' "$hint"

# The deployment is tagged with GITHUB_SHA; it must be the commit that was
# checked out and built, or the tag would point at the wrong change.
head="$(git -C "$(dirname "$0")/.." rev-parse HEAD 2>/dev/null || true)"
if [[ ! "${GITHUB_SHA:-}" =~ ^[0-9a-f]{40}$ ]]; then
  echo "deploy-preflight: GITHUB_SHA is missing or not a commit SHA" >&2
  failures=$((failures + 1))
elif [[ "$GITHUB_SHA" != "$head" ]]; then
  echo "deploy-preflight: checked-out commit $head is not GITHUB_SHA $GITHUB_SHA" >&2
  failures=$((failures + 1))
else
  echo "deploy-preflight: ok   build commit matches GITHUB_SHA"
fi

for name in CLOUDFLARE_ACCOUNT_ID PAGES_PROJECT_NAME; do
  expected_name="EXPECTED_$name"
  if [[ -n "${!expected_name:-}" && "${!expected_name}" != "${!name:-}" ]]; then
    echo "deploy-preflight: $name differs from the value the build job checked; remove any production environment variable named $name" >&2
    failures=$((failures + 1))
  fi
done

if (( failures )); then
  echo "deploy-preflight: $failures problem(s); stopping before any approval or upload" >&2
  exit 1
fi
if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  {
    echo "cloudflare_account_id=$CLOUDFLARE_ACCOUNT_ID"
    echo "pages_project_name=$PAGES_PROJECT_NAME"
  } >> "$GITHUB_OUTPUT"
fi
echo "deploy-preflight: ready to deploy"
