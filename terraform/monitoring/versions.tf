terraform {
  required_version = ">= 1.10.0"

  # Organisation comes from TF_CLOUD_ORGANIZATION, as in the other stacks.
  # Monitoring has its own workspace, state and credentials: a mistake here
  # cannot plan changes against the site or the repository.
  cloud {
    workspaces {
      name = "termstash-monitoring"
    }
  }

  required_providers {
    grafana = {
      source  = "grafana/grafana"
      version = "4.46.0"
    }
  }
}

# Authenticates with GRAFANA_AUTH, a stack service account token with the
# Editor role (enough for SLOs, alert rules and contact points), and
# GRAFANA_SM_ACCESS_TOKEN from Synthetics, Config. Both are sensitive
# environment variables on the HCP workspace.
provider "grafana" {
  url    = var.grafana_url
  sm_url = var.sm_url
}
