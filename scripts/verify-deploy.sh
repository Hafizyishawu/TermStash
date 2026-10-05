#!/usr/bin/env bash
# Confirms the live site is exactly the build that was just deployed and that
# its security headers are in force. A deploy that reports success but serves
# something else, or serves the right files without their CSP, fails here.
# Read-only: it only fetches public URLs.
#
#   scripts/verify-deploy.sh <base-url> <site-dir>
set -euo pipefail

base_url="${1:?usage: verify-deploy.sh <base-url> <site-dir>}"
site_dir="${2:?usage: verify-deploy.sh <base-url> <site-dir>}"
base_url="${base_url%/}"
attempts="${VERIFY_ATTEMPTS:-12}"
delay_seconds="${VERIFY_DELAY_SECONDS:-10}"
# A query string keeps any intermediate cache from answering with an older copy.
bust="verify=${GITHUB_SHA:-$(date +%s)}"

sha256() {
  if command -v sha256sum >/dev/null; then sha256sum | cut -d' ' -f1; else shasum -a 256 | cut -d' ' -f1; fi
}

# Pages serves index.html at the directory URL and consumes _headers itself.
url_path() {
  case "$1" in
    index.html) echo "/" ;;
    _headers) echo "" ;;
    *) echo "/$1" ;;
  esac
}

mismatched_files() {
  local file path expected actual
  while IFS= read -r file; do
    path="$(url_path "$file")"
    [[ -z "$path" ]] && continue
    expected="$(sha256 < "$site_dir/$file")"
    actual="$(curl -fsSL --compressed --max-time 15 "$base_url$path?$bust" | sha256 || true)"
    [[ "$expected" == "$actual" ]] || echo "$file"
  done < <(cd "$site_dir" && find . -type f | sed 's|^\./||' | sort)
}

mismatched=""
for ((attempt = 1; attempt <= attempts; attempt++)); do
  mismatched="$(mismatched_files)"
  [[ -z "$mismatched" ]] && break
  echo "verify-deploy: attempt $attempt/$attempts, still serving older copies of: $(echo "$mismatched" | tr '\n' ' ')"
  (( attempt < attempts )) && sleep "$delay_seconds"
done
if [[ -n "$mismatched" ]]; then
  echo "verify-deploy: live site does not match the build" >&2
  exit 1
fi
echo "verify-deploy: every built file is live at $base_url"

# A failed request yields an empty value, which require reports as a failure,
# rather than ending the script without saying which check broke.
header() {
  { curl -fsSI --max-time 15 "$base_url$1?$bust" || true; } | tr -d '\r' | awk -v name="$2" 'tolower($0) ~ "^" tolower(name) ":" { sub(/^[^:]*:[ \t]*/, ""); print; exit }'
}

failures=0
require() {
  local description="$1" value="$2" pattern="$3"
  if [[ "$value" =~ $pattern ]]; then
    echo "verify-deploy: ok   $description"
  else
    echo "verify-deploy: FAIL $description (got: ${value:-nothing})" >&2
    failures=$((failures + 1))
  fi
}

page_csp="$(header / content-security-policy)"
require "page CSP blocks all network requests" "$page_csp" "connect-src 'none'"
require "page CSP forbids framing" "$page_csp" "frame-ancestors 'none'"
require "HSTS is set" "$(header / strict-transport-security)" "max-age=[0-9]+"
require "MIME sniffing is off" "$(header / x-content-type-options)" "^nosniff$"
require "page is revalidated on every visit" "$(header / cache-control)" "no-cache"
# The worker's own policy must replace the page policy, not add to it, or its
# fetches are blocked and the site never works offline.
require "service worker has its own same-origin CSP" "$(header /sw.js content-security-policy)" "^default-src 'none'; connect-src 'self'$"

if (( failures )); then
  echo "verify-deploy: $failures header check(s) failed" >&2
  exit 1
fi
echo "verify-deploy: all checks passed"
