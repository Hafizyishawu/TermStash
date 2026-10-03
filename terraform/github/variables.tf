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
  description = "Repository visibility. Changing this to public is irreversible for anything already pushed: complete the pre-publication check (G3.12) before applying it."
  default     = "private"

  validation {
    condition     = contains(["private", "public"], var.repository_visibility)
    error_message = "repository_visibility must be private or public."
  }
}

variable "required_status_checks" {
  type        = list(string)
  description = "CI job names that must pass before a pull request can merge into the default branch. Every name here must run on every pull request, or merges block forever."
  default     = ["test", "terraform"]
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
