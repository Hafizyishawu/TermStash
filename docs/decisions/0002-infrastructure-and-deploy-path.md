# 0002: Infrastructure as code and the deploy path

## Context

TermStash is a static site that will be public at termstash.app, from a
public repository. A tampered build served from that domain could read
every command stored in visitors' browsers, so how code reaches production
is the main security boundary. The domain and DNS were registered on
Cloudflare; GitHub Free protects public repositories only.

## Decision

- **All infrastructure in Terraform**, in two stacks with separate state and
  credentials: `github/` for repository settings and rules, `cloudflare/` for
  DNS, TLS and the Pages project. State is in HCP Terraform; plans run there
  on every pull request, and applies need a human to confirm.
- **Cloudflare Pages in Direct Upload mode.** The dashboard's Git integration
  deploys on every push without waiting for CI and cannot be switched to
  Direct Upload later. Deployments come only from the CI pipeline, after its
  checks pass and an approval on the protected `production` environment.
- **No bypass of the default-branch ruleset**, including for the owner.
- **Domain hardening in code**: CAA limited to the CAs Cloudflare uses, DNSSEC
  on, null MX, SPF fail-all and DMARC reject because the domain sends no mail.
- **Protection and publication together.** The ruleset, environment and secret
  scanning switch on in the same apply that makes the repository public.

## Consequences

- Every infrastructure change is reviewable and reversible, and nothing about
  production depends on remembered dashboard clicks.
- Cloudflare offers no OIDC for API tokens, so two static tokens exist. Each is
  scoped to the minimum, stored only as a sensitive HCP variable, and must be
  rotated before expiry; a missed rotation breaks applies, not the live site.
- The HCP organisation, workspaces and their variables are created once by
  hand, documented in `terraform/README.md`. Codifying them with the `tfe`
  provider is a follow-up.
- As a solo repository, pull requests cannot require an approving review.
  Required checks plus a documented self-review stand in until a second
  maintainer exists.
