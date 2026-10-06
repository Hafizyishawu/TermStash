variable "grafana_url" {
  type        = string
  description = "Grafana Cloud stack URL, for example https://example.grafana.net."

  validation {
    condition     = can(regex("^https://[a-z0-9-]+\\.grafana\\.net/?$", var.grafana_url))
    error_message = "grafana_url must be a https://<stack>.grafana.net URL."
  }
}

variable "sm_url" {
  type        = string
  description = "Synthetic Monitoring API URL for the stack's region, shown on Synthetics, Config."

  validation {
    condition     = can(regex("^https://synthetic-monitoring-api[a-z0-9.-]*\\.grafana\\.net/?$", var.sm_url))
    error_message = "sm_url must be the stack region's https://synthetic-monitoring-api...grafana.net URL."
  }
}

variable "alert_email" {
  type        = string
  description = "Where alerts are sent. Sensitive so the address stays out of plan output; the repository is public."
  sensitive   = true

  validation {
    condition     = can(regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", var.alert_email))
    error_message = "alert_email must be an email address."
  }
}

variable "site_url" {
  type        = string
  description = "Page the uptime check requests."
  default     = "https://termstash.app/"
}

variable "probe_names" {
  type        = list(string)
  description = "Public probe locations. Three regions so one probe's network trouble does not look like an outage."
  default     = ["London", "Frankfurt", "NorthVirginia"]

  validation {
    condition     = length(var.probe_names) >= 3 && length(var.probe_names) % 2 == 1
    error_message = "Use an odd number of probes, at least three, so a majority survives one probe failing."
  }
}

variable "check_frequency_seconds" {
  type        = number
  description = "Seconds between runs from each probe. Free tier allows 100k API test runs a month: 3 probes every 120s is about 65k."
  default     = 120

  validation {
    condition     = var.check_frequency_seconds >= 60 && var.check_frequency_seconds <= 300
    error_message = "check_frequency_seconds must be between 60 and 300, so every 15-minute alert window holds several runs."
  }
}

variable "availability_objective" {
  type        = number
  description = "Fraction of time a majority of probes must pass over the SLO window. 0.999 over 28 days allows about 40 minutes of failure."
  default     = 0.999

  validation {
    condition     = var.availability_objective > 0.9 && var.availability_objective < 1
    error_message = "availability_objective must be between 0.9 and 1, exclusive."
  }
}

variable "prometheus_datasource_uid" {
  type        = string
  description = "UID of the stack's hosted Prometheus data source, where Synthetic Monitoring writes probe metrics."
  default     = "grafanacloud-prom"
}

variable "runbook_url" {
  type        = string
  description = "Runbook linked from every alert."
  default     = "https://github.com/Hafizyishawu/TermStash/blob/main/docs/runbooks/uptime-alerts.md"
}
