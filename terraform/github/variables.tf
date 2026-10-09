variable "github_owner" {
  type        = string
  description = "GitHub account that owns the repository."
  default     = "Hafizyishawu"
}

variable "repository_name" {
  type        = string
  description = "Name of the existing repository to manage."
  default     = "TermStash"
}

variable "repository_visibility" {
  type        = string
  description = "Repository visibility. Public since 2026-10-05, after the pre-publication check (G3.12) passed. Setting this back to private does not recall clones or forks made while public."
  default     = "public"

  validation {
    condition     = contains(["private", "public"], var.repository_visibility)
    error_message = "repository_visibility must be private or public."
  }
}

variable "required_status_checks" {
  type        = list(string)
  description = "GitHub Actions job names that must pass before a pull request can merge into the default branch. Each check is pinned to the GitHub Actions app, so a check reported by any other app (HCP Terraform included) can never satisfy it. Every name here must run on every pull request, or merges block forever."
  default     = ["test", "terraform", "e2e"]
}

variable "production_reviewers" {
  type        = list(number)
  description = "GitHub user IDs allowed to approve production deployments."
  default     = [104676870]
}

variable "allowed_third_party_actions" {
  type        = list(string)
  description = "Third-party actions workflows may use, as owner/repo@* patterns. SHA pinning is enforced separately, so * here does not allow tags."
  default = [
    "hashicorp/setup-terraform@*",
    "terraform-linters/setup-tflint@*",
    "bridgecrewio/checkov-action@*",
  ]

  validation {
    condition     = alltrue([for pattern in var.allowed_third_party_actions : can(regex("^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+@\\*$", pattern))])
    error_message = "Each allowed action must be an owner/repo@* pattern."
  }
}

variable "require_signed_commits" {
  type        = bool
  description = "Whether commits to the default branch must be signed. Off until commit signing is set up locally (risk register, G3.4)."
  default     = false
}

variable "cloudflare_account_id" {
  type        = string
  description = "Cloudflare account the deploy job uploads to. Not a secret; the same value as account_id in the cloudflare workspace."

  # Same pattern as scripts/deploy-preflight.sh; change both together.
  validation {
    condition     = can(regex("^[0-9a-f]{32}$", var.cloudflare_account_id))
    error_message = "cloudflare_account_id must be a 32-character lowercase hex Cloudflare account ID."
  }
}

variable "pages_project_name" {
  type        = string
  description = "Cloudflare Pages project the deploy job uploads to. Copied from pages_project_name in the cloudflare workspace rather than read from its outputs, which would need an HCP token here; a mismatch fails the deploy's verify step."
  default     = "termstash"

  # Same pattern as scripts/deploy-preflight.sh; change both together.
  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9-]{0,56}[a-z0-9]$", var.pages_project_name))
    error_message = "pages_project_name must be lowercase letters, digits and hyphens, 2 to 58 characters."
  }
}
