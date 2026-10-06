# Security policy

## Reporting a vulnerability

Report privately through GitHub:
https://github.com/Hafizyishawu/TermStash/security/advisories/new

Please do not open a public issue or pull request for a vulnerability; that
discloses it before a fix is available. The private report is visible only
to the maintainer.

Include what you found, how to reproduce it, and what an attacker could do
with it. A proof of concept against your own copy of the app is welcome;
please do not test against other people's data or degrade the site for
other visitors.

## What to expect

- An acknowledgement within 5 working days.
- An assessment and, where it is a vulnerability, a fix or mitigation plan
  within 30 days. Critical issues are worked on straight away.
- Credit in the advisory when it is published, if you want it.

This is a solo, unpaid project, so there is no bug bounty.

## Scope

In scope:

- The app at https://termstash.app and its code in this repository,
  including pack import and export, the secret and hidden-character
  detection, and the service worker.
- The security headers and Content-Security-Policy in `_headers`.
- The infrastructure defined in `terraform/` and the CI/CD workflows in
  `.github/workflows/`.

Out of scope:

- Vulnerabilities in Cloudflare, GitHub or Grafana Cloud themselves; report
  those to the vendor.
- Findings that need a compromised device or browser, or physical access.
- Missing headers or settings with no demonstrated impact, and automated
  scanner output without a working issue.

## How TermStash limits impact

Commands are stored only in the browser's local storage and never sent
anywhere: the page's Content-Security-Policy blocks all network requests
(`connect-src 'none'`). A vulnerability that would exfiltrate data has to
get past that policy first.
