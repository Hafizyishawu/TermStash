locals {
  # GitHub Free offers rulesets, protected environments and secret scanning
  # on public repositories only. While the repository is private these
  # resources are planned out rather than failing the apply.
  public = var.repository_visibility == "public"
}

# The repository already exists; adopt it instead of creating a new one.
import {
  to = github_repository.termstash
  id = var.repository_name
}

resource "github_repository" "termstash" {
  #checkov:skip=CKV_GIT_1:Public by decision (ADR 0002, FSL licence). Made public after the pre-publication history scan; protections below are gated on it.
  #checkov:skip=CKV_GIT_3:Vulnerability alerts are enabled by github_repository_vulnerability_alerts below, the provider's replacement for this resource's deprecated attribute.
  name         = var.repository_name
  description  = "A local-first notepad for the commands you use often but cannot remember."
  homepage_url = "https://termstash.app"
  visibility   = var.repository_visibility

  has_issues      = true
  has_discussions = false
  has_projects    = false
  has_wiki        = false

  allow_merge_commit     = false
  allow_rebase_merge     = false
  allow_squash_merge     = true
  delete_branch_on_merge = true

  # A destroy or a renamed resource must never delete the repository.
  archive_on_destroy = true

  dynamic "security_and_analysis" {
    for_each = local.public ? [1] : []
    content {
      secret_scanning {
        status = "enabled"
      }
      secret_scanning_push_protection {
        status = "enabled"
      }
    }
  }

  lifecycle {
    prevent_destroy = true
  }
}

# Workflows may run only GitHub's own actions and the named third-party ones,
# and every action must be pinned to a full commit SHA. GitHub refuses to run
# anything else, so a tag-pinned or unknown action cannot slip in through a
# workflow change.
resource "github_actions_repository_permissions" "termstash" {
  repository           = github_repository.termstash.name
  enabled              = true
  allowed_actions      = "selected"
  sha_pinning_required = true

  allowed_actions_config {
    github_owned_allowed = true
    verified_allowed     = false
    patterns_allowed     = var.allowed_third_party_actions
  }
}

resource "github_repository_vulnerability_alerts" "termstash" {
  repository = github_repository.termstash.name
  enabled    = true
}

resource "github_repository_dependabot_security_updates" "termstash" {
  depends_on = [github_repository_vulnerability_alerts.termstash]
  repository = github_repository.termstash.name
  enabled    = true
}

# Every change reaches the default branch through a pull request whose
# checks have passed. There are no bypass actors: an emergency change goes
# through this file, which leaves a reviewed record.
resource "github_repository_ruleset" "default_branch" {
  count = local.public ? 1 : 0

  name        = "default-branch"
  repository  = github_repository.termstash.name
  target      = "branch"
  enforcement = "active"

  conditions {
    ref_name {
      include = ["~DEFAULT_BRANCH"]
      exclude = []
    }
  }

  rules {
    deletion                = true
    non_fast_forward        = true
    required_linear_history = true
    required_signatures     = var.require_signed_commits

    # Solo repository: GitHub does not let an author approve their own pull
    # request, so review is a documented self-review step plus the required
    # checks below (G3.3) rather than a required approval.
    pull_request {
      required_approving_review_count   = 0
      dismiss_stale_reviews_on_push     = true
      require_last_push_approval        = false
      required_review_thread_resolution = true
    }

    required_status_checks {
      strict_required_status_checks_policy = true

      dynamic "required_check" {
        for_each = var.required_status_checks
        content {
          context = required_check.value
          # Only GitHub Actions can satisfy the check. Without this, anyone with
          # write access could post a passing commit status of the same name.
          integration_id = 15368
        }
      }
    }
  }
}

# Production deploys wait for a named reviewer and only run from the
# default branch.
resource "github_repository_environment" "production" {
  count = local.public ? 1 : 0

  repository  = github_repository.termstash.name
  environment = "production"
  # Solo maintainer: self-review must be allowed or nothing could deploy.
  # The gate still forces a deliberate approval per deployment; revisit when
  # a second maintainer exists.
  prevent_self_review = false

  reviewers {
    users = var.production_reviewers
  }

  # protected_branches counts classic branch protection only, not rulesets,
  # and GitHub lets every branch deploy when no classic rule exists. main is
  # protected by a ruleset, so the branch is named explicitly instead.
  deployment_branch_policy {
    protected_branches     = false
    custom_branch_policies = true
  }
}

resource "github_repository_environment_deployment_policy" "production_main" {
  count = local.public ? 1 : 0

  repository     = github_repository.termstash.name
  environment    = github_repository_environment.production[0].environment
  branch_pattern = "main"
}

# Non-secret settings the deploy job reads. The Cloudflare token itself is an
# environment secret set by hand: a value managed here would also be stored in
# HCP state, a second copy to protect.
resource "github_actions_environment_variable" "cloudflare_account_id" {
  count = local.public ? 1 : 0

  repository    = github_repository.termstash.name
  environment   = github_repository_environment.production[0].environment
  variable_name = "CLOUDFLARE_ACCOUNT_ID"
  value         = var.cloudflare_account_id
}

resource "github_actions_environment_variable" "pages_project_name" {
  count = local.public ? 1 : 0

  repository    = github_repository.termstash.name
  environment   = github_repository_environment.production[0].environment
  variable_name = "PAGES_PROJECT_NAME"
  value         = var.pages_project_name
}
