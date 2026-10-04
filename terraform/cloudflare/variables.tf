variable "account_id" {
  type        = string
  description = "Cloudflare account ID that owns the zone and the Pages project. Set on the HCP workspace; not a secret, but kept out of the repository."

  validation {
    condition     = can(regex("^[0-9a-f]{32}$", var.account_id))
    error_message = "account_id must be a 32-character lowercase hex Cloudflare account ID."
  }
}

variable "domain" {
  type        = string
  description = "Apex domain served by the site."
  default     = "termstash.app"
}

variable "pages_project_name" {
  type        = string
  description = "Cloudflare Pages project name; also the *.pages.dev subdomain."
  default     = "termstash"

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9-]{0,56}[a-z0-9]$", var.pages_project_name))
    error_message = "pages_project_name must be lowercase letters, digits and hyphens, 2 to 58 characters."
  }
}

variable "production_branch" {
  type        = string
  description = "Git branch whose deployments are production."
  default     = "main"
}

variable "allowed_certificate_authorities" {
  type        = list(string)
  description = "CAA issuers allowed to issue certificates for the domain. Cloudflare issues edge certificates through these authorities; removing one can break certificate renewal."
  default     = ["letsencrypt.org", "pki.goog", "ssl.com", "sectigo.com"]
}
