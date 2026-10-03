terraform {
  required_version = ">= 1.10.0"

  # Organisation comes from TF_CLOUD_ORGANIZATION so no account identifier is
  # committed. Each stack has its own workspace and state: a mistake in one
  # cannot plan changes against the other.
  cloud {
    workspaces {
      name = "termstash-github"
    }
  }

  required_providers {
    github = {
      source  = "integrations/github"
      version = "~> 6.13"
    }
  }
}

# Authenticates with GITHUB_TOKEN, a fine-grained token limited to this one
# repository, set as a sensitive environment variable on the HCP workspace.
provider "github" {
  owner = var.github_owner
}
