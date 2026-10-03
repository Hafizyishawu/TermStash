#!/usr/bin/env bash
# Static checks for every Terraform stack under terraform/. Runs without
# credentials or state: init skips the HCP backend, so this is safe on forks
# and on every pull request. Plans run in HCP Terraform, not here.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
stacks=()
while IFS= read -r dir; do stacks+=("$dir"); done < <(find "$root/terraform" -mindepth 1 -maxdepth 1 -type d ! -name '.*' | sort)

if [[ ${#stacks[@]} -eq 0 ]]; then
  echo "terraform-check: no stacks found under terraform/" >&2
  exit 1
fi

terraform fmt -check -recursive -diff "$root/terraform"

for stack in "${stacks[@]}"; do
  name="${stack#"$root"/}"
  echo "== $name"
  terraform -chdir="$stack" init -backend=false -input=false -no-color >/dev/null
  terraform -chdir="$stack" validate -no-color
  if command -v tflint >/dev/null 2>&1; then
    tflint --chdir="$stack" --init >/dev/null
    tflint --chdir="$stack" --format=compact
  else
    echo "tflint not installed; skipping lint for $name" >&2
    [[ -n "${CI:-}" ]] && exit 1
  fi
done

echo "terraform-check: ${#stacks[@]} stack(s) passed"
