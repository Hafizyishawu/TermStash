#!/usr/bin/env bash
# Applies the repository settings the Terraform GitHub provider cannot manage.
# Reads the live value first and changes only what differs, so running it
# again is a no-op. Remove a setting from here once the provider supports it
# and it moves into terraform/github.
#
#   scripts/github-repo-settings.sh [--dry-run] [owner/repo]
#
# Exit codes: 0 settings match (or were applied), 2 usage or read error,
# 3 dry run found drift. Needs gh authenticated as a repository admin.
set -euo pipefail

dry_run=0
repo=""
for argument in "$@"; do
  case "$argument" in
    --dry-run) dry_run=1 ;;
    -*) echo "github-repo-settings: unknown option $argument" >&2; exit 2 ;;
    *)
      if [[ -n "$repo" ]]; then
        echo "github-repo-settings: only one repository may be given" >&2
        exit 2
      fi
      repo="$argument"
      ;;
  esac
done
repo="${repo:-Hafizyishawu/TermStash}"
changes=0

# A failed request must stop the script, not be compared as a value: gh
# prints the error body on stdout, and set -e does not reach into $(...), so
# the exit status is checked explicitly.
read_setting() {
  local value errors
  errors="$(mktemp)"
  if ! value="$(gh api "$1" --jq "$2" 2>"$errors")" || [[ -z "$value" ]]; then
    echo "github-repo-settings: could not read $1:" >&2
    sed 's/^/  /' "$errors" >&2
    rm -f "$errors"
    exit 2
  fi
  rm -f "$errors"
  printf '%s' "$value"
}

apply() {
  local description="$1" current="$2" wanted="$3"
  shift 3
  if [[ "$current" == "$wanted" ]]; then
    echo "github-repo-settings: ok      $description ($current)"
    return
  fi
  changes=$((changes + 1))
  if (( dry_run )); then
    echo "github-repo-settings: would   $description: $current -> $wanted"
  else
    "$@" >/dev/null
    echo "github-repo-settings: changed $description: $current -> $wanted"
  fi
}

# Lets researchers report a vulnerability privately through GitHub instead of
# in a public issue.
reporting="$(read_setting "repos/$repo/private-vulnerability-reporting" '.enabled')"
apply "private vulnerability reporting" "$reporting" "true" \
  gh api -X PUT "repos/$repo/private-vulnerability-reporting"

# Workflows from any outside contributor's fork wait for a maintainer to
# approve them, not only a first-time contributor's: one merged typo fix must
# not grant later pull requests free use of CI.
fork_approval="$(read_setting "repos/$repo/actions/permissions/fork-pr-contributor-approval" '.approval_policy')"
apply "fork pull request workflow approval" "$fork_approval" "all_external_contributors" \
  gh api -X PUT "repos/$repo/actions/permissions/fork-pr-contributor-approval" -f approval_policy=all_external_contributors

if (( dry_run )); then
  echo "github-repo-settings: dry run, $changes change(s) pending"
  (( changes == 0 )) || exit 3
else
  echo "github-repo-settings: $changes change(s) applied"
fi
