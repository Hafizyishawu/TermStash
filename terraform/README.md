# Infrastructure

Everything TermStash runs on is defined here. Nothing is created by hand in
a dashboard; if a setting is missing from this directory, it is not managed.

| Stack | Manages | HCP workspace |
| --- | --- | --- |
| `github/` | Repository settings, default-branch ruleset, production environment, vulnerability alerts | `termstash-github` |
| `cloudflare/` | Pages project (Direct Upload), custom domain, www redirect, DNS, CAA, DNSSEC, email anti-spoofing, zone TLS settings | `termstash-cloudflare` |

Each stack has its own state and its own credential, so a mistake or a
leaked token in one cannot change the other.

## State and runs

State lives in HCP Terraform. The organisation is read from
`TF_CLOUD_ORGANIZATION`; no account identifier is committed.

Both workspaces are VCS-driven, with auto-apply off:

- A pull request touching a stack triggers a speculative plan, posted to the
  pull request as a check.
- Merging to `main` queues a plan that waits for a human to confirm the apply
  in HCP Terraform.

Nobody applies from a laptop. `scripts/terraform-check.sh` runs format,
validate and tflint without credentials, and the `terraform` CI workflow runs
it plus checkov on every push and pull request.

## One-time setup

These steps create the workspaces and credentials, which cannot manage
themselves. Codifying them with the `tfe` provider is a follow-up.

1. In HCP Terraform, create the organisation if needed, then two workspaces
   using the version control workflow on this repository:
   - `termstash-github`, working directory `terraform/github`
   - `termstash-cloudflare`, working directory `terraform/cloudflare`
   Set the trigger to the workspace's working directory, and turn auto-apply
   off on both.
2. Create the credentials, each with the minimum access and an expiry:
   - **GitHub**: a fine-grained personal access token, repository access
     limited to `TermStash`, with repository permissions Administration (read
     and write), Environments (read and write) and Metadata (read). Nothing
     else. Expiry 90 days.
   - **Cloudflare**: a custom API token with Zone (read), DNS (edit), Zone
     Settings (edit) and Single Redirect (edit, for the www redirect), all
     limited to the `termstash.app` zone, plus Account
     Cloudflare Pages (edit). DNS (edit) also covers DNSSEC; there is no
     separate DNSSEC permission. Set an expiry. Do not add an IP filter: runs
     on HCP Terraform's shared agents have no fixed, published egress range,
     so a filtered token fails every plan.
3. Add workspace variables:
   - `termstash-github`: environment variable `GITHUB_TOKEN`, sensitive.
   - `termstash-cloudflare`: environment variable `CLOUDFLARE_API_TOKEN`,
     sensitive; Terraform variable `account_id`, not sensitive.
4. Record each token's expiry in the readiness plan's expiry tracking (G10.6).

## Apply order

1. Merge the application pull request first, so the `test` check exists on
   `main` before the ruleset requires it.
2. Apply `cloudflare/`. Then confirm `dig +short termstash.app DS` returns a
   record, `curl -sI https://termstash.app` responds, and
   `curl -sI 'https://www.termstash.app/x?y=1'` returns 301 with
   `location: https://termstash.app/x?y=1`.
3. Apply `github/` while the repository is private: settings and alerts only,
   because GitHub Free offers rulesets and environments on public
   repositories only.
4. After the pre-publication check passes, set `repository_visibility` to
   `public` in a pull request. That plan adds the ruleset, the production
   environment and secret scanning in the same apply that publishes the
   repository. The apply is not atomic: the repository turns public first,
   and if a later resource fails it stays public with `main` unprotected.
   Straight after the apply, confirm the `protections_active` output is
   `true` and `gh api repos/Hafizyishawu/TermStash/rulesets` lists
   `default-branch`. If either check fails, make the repository private in
   the GitHub settings at once (break-glass), then open a pull request
   setting `repository_visibility` back to `private`, or the next apply from
   `main` makes it public again. Treat the time it was public as an
   exposure: clones and forks made then cannot be recalled.

## Guard rails

- The repository and the Pages project have `prevent_destroy`, and the
  repository archives rather than deletes on destroy.
- The ruleset has no bypass actors. An emergency change to `main` goes
  through a pull request to this directory.
- `required_status_checks` must name jobs that run on every pull request.
  Requiring a job that has a path filter blocks merges for good.

## Not yet codified

The GitHub provider has no resource for these repository settings. Until it
does, apply them with the API after the repository goes public, and recheck
them in the week-1 review:

```bash
gh api -X PUT repos/Hafizyishawu/TermStash/private-vulnerability-reporting
```

```bash
gh api -X PUT repos/Hafizyishawu/TermStash/actions/permissions/fork-pr-contributor-approval -f approval_policy=all_external_contributors
```

## Break-glass

If HCP Terraform is unavailable during an incident, an owner with the
workspace's credential may run `terraform plan` and `apply` locally against
the HCP state, using `terraform login`. Record who, when, why and the plan
output in the incident notes, and open a pull request reconciling any change
within one working day.
