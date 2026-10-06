#!/usr/bin/env bash
# Checks, in the build job, everything the deploy needs that the build job can
# see, so a deploy that cannot succeed fails before it asks for a production
# approval. Missing variables usually mean the terraform/github apply that
# creates them has not run yet.
#
# The Cloudflare token is a production environment secret, which only the
# approved deploy job can read; deploy-pages.sh checks it there.
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

if (( failures )); then
  echo "deploy-preflight: $failures problem(s); not requesting a production approval" >&2
  exit 1
fi
echo "deploy-preflight: ready to deploy"
