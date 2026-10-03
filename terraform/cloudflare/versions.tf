terraform {
  required_version = ">= 1.10.0"

  # Organisation comes from TF_CLOUD_ORGANIZATION; separate workspace and
  # state from the GitHub stack.
  cloud {
    workspaces {
      name = "termstash-cloudflare"
    }
  }

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.26"
    }
  }
}

# Authenticates with CLOUDFLARE_API_TOKEN, set as a sensitive environment
# variable on the HCP workspace. The token is scoped to this account's Pages
# and to the termstash.app zone only (see README.md for the exact permissions).
provider "cloudflare" {}
