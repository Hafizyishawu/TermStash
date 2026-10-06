data "grafana_synthetic_monitoring_probes" "public" {
  filter_deprecated = true
}

# Fails at plan time if the stack's Prometheus data source is not where the
# SLO and alert rules expect it, rather than at apply.
data "grafana_data_source" "prometheus" {
  uid = var.prometheus_datasource_uid
}

locals {
  check_job = "termstash-home"
  # The selector every query uses, so the SLO, the alerts and the check agree
  # on which series they mean.
  probe_selector = "job=\"${local.check_job}\", instance=\"${var.site_url}\""
  # A time slice counts as available when a majority of probes pass, so one
  # probe's own network trouble is not an outage.
  probe_quorum = floor(length(var.probe_names) / 2) + 1
  per_probe_success_ratio = join(" ", [
    "sum by (probe) (rate(probe_all_success_sum{${local.probe_selector}}[$__rate_interval]))",
    "/",
    "sum by (probe) (rate(probe_all_success_count{${local.probe_selector}}[$__rate_interval]))",
  ])
}

# Outside-in check of what a visitor gets: the page loads over TLS, it is the
# app, and its CSP still blocks all network requests. A deploy that drops the
# security headers fails this check, not only one that takes the site down.
resource "grafana_synthetic_monitoring_check" "home" {
  job       = local.check_job
  target    = var.site_url
  enabled   = true
  frequency = var.check_frequency_seconds * 1000
  timeout   = 10000
  probes    = [for name in var.probe_names : data.grafana_synthetic_monitoring_probes.public.probes[name]]

  labels = {
    service = "termstash"
  }

  settings {
    http {
      method                          = "GET"
      valid_status_codes              = [200]
      fail_if_not_ssl                 = true
      fail_if_body_not_matches_regexp = ["TermStash"]
      # Requests carry a changing query parameter so every run reaches the
      # live deployment rather than a cached copy.
      cache_busting_query_param_name = "probe"

      fail_if_header_not_matches_regexp {
        header = "Content-Security-Policy"
        regexp = "connect-src 'none'"
      }
    }
  }

  lifecycle {
    precondition {
      condition     = alltrue([for name in var.probe_names : contains(keys(data.grafana_synthetic_monitoring_probes.public.probes), name)])
      error_message = "Every name in probe_names must be a current public probe; see Synthetics, Probes."
    }
    # The free tier allows 100k API test runs a month; stopping at 90k keeps
    # headroom, and going over would stop checks mid-month.
    precondition {
      condition     = length(var.probe_names) * 30 * 24 * 3600 / var.check_frequency_seconds <= 90000
      error_message = "probe_names and check_frequency_seconds exceed 90k test runs a month; reduce probes or run less often."
    }
  }
}

resource "grafana_folder" "termstash" {
  title = "TermStash"
}

# Availability is the share of time in which a majority of probes passed
# every assertion: 1 when at least probe_quorum probes each passed more than
# half their runs in the interval, 0 otherwise. A probe at exactly half fails.
# Pooling all runs instead would turn one failing probe into a third of runs
# failing, a fast burn. Alerts fire on how fast the error budget burns, so a
# single failed run is not an alert but a sustained outage is.
resource "grafana_slo" "availability" {
  name        = "TermStash availability"
  description = "Share of synthetic checks of ${var.site_url} that load the app with its security headers, from ${length(var.probe_names)} regions."
  folder_uid  = grafana_folder.termstash.uid

  query {
    type = "freeform"
    freeform {
      query = "sum((${local.per_probe_success_ratio}) > bool 0.5) >= bool ${local.probe_quorum}"
    }
  }

  objectives {
    value  = var.availability_objective
    window = "28d"
  }

  destination_datasource {
    uid = data.grafana_data_source.prometheus.uid
  }

  label {
    key   = "service"
    value = "termstash"
  }

  alerting {
    fastburn {
      annotation {
        key   = "summary"
        value = "TermStash is failing its uptime check fast enough to spend the month's error budget within days."
      }
      annotation {
        key   = "runbook_url"
        value = "${var.runbook_url}#fast-burn"
      }
      label {
        key   = "severity"
        value = "critical"
      }
    }

    slowburn {
      annotation {
        key   = "summary"
        value = "TermStash is failing its uptime check often enough to miss its availability objective this window."
      }
      annotation {
        key   = "runbook_url"
        value = "${var.runbook_url}#slow-burn"
      }
      label {
        key   = "severity"
        value = "warning"
      }
    }
  }
}

resource "grafana_rule_group" "probe_health" {
  name             = "termstash-probe-health"
  folder_uid       = grafana_folder.termstash.uid
  interval_seconds = 300

  # Cloudflare renews the certificate on its own; this is the backstop if
  # that ever stops. Certificate data exists only when a TLS handshake
  # completes, so no data here is an outage or a monitoring gap, both
  # covered by other alerts; it must not fire this one.
  rule {
    name           = "TermStash TLS certificate expires within 14 days"
    condition      = "below_threshold"
    for            = "15m"
    no_data_state  = "OK"
    exec_err_state = "Error"

    data {
      ref_id         = "days_left"
      datasource_uid = data.grafana_data_source.prometheus.uid
      relative_time_range {
        from = 900
        to   = 0
      }
      model = jsonencode({
        refId   = "days_left"
        expr    = "min((max_over_time(probe_ssl_earliest_cert_expiry{${local.probe_selector}}[15m]) - time()) / 86400)"
        instant = true
      })
    }

    data {
      ref_id         = "below_threshold"
      datasource_uid = "__expr__"
      relative_time_range {
        from = 0
        to   = 0
      }
      model = jsonencode({
        refId      = "below_threshold"
        type       = "threshold"
        expression = "days_left"
        conditions = [{ evaluator = { type = "lt", params = [14] } }]
      })
    }

    annotations = {
      summary     = "The TLS certificate for termstash.app expires within 14 days."
      runbook_url = "${var.runbook_url}#certificate-expiring"
    }
    labels = {
      service  = "termstash"
      severity = "warning"
    }
  }

  # Probes report a run count whether the run passes or fails, so its absence
  # means the monitoring itself has stopped, and the SLO cannot alert on data
  # it never receives. The condition never holds; only no data fires it.
  rule {
    name           = "TermStash probe data missing"
    condition      = "no_reports"
    for            = "10m"
    no_data_state  = "Alerting"
    exec_err_state = "Error"

    data {
      ref_id         = "reporting_probes"
      datasource_uid = data.grafana_data_source.prometheus.uid
      relative_time_range {
        from = 300
        to   = 0
      }
      model = jsonencode({
        refId   = "reporting_probes"
        expr    = "count(count_over_time(probe_all_success_count{${local.probe_selector}}[5m]))"
        instant = true
      })
    }

    data {
      ref_id         = "no_reports"
      datasource_uid = "__expr__"
      relative_time_range {
        from = 0
        to   = 0
      }
      model = jsonencode({
        refId      = "no_reports"
        type       = "threshold"
        expression = "reporting_probes"
        conditions = [{ evaluator = { type = "lt", params = [1] } }]
      })
    }

    annotations = {
      summary     = "No TermStash probe has reported for about 15 minutes; outages will not alert until it does."
      runbook_url = "${var.runbook_url}#probe-data-missing"
    }
    labels = {
      service  = "termstash"
      severity = "warning"
    }
  }

  # The quorum hides one failing probe from the SLO, which is the point, but
  # it leaves no spare: one more failure would count as an outage. This warns
  # when any single probe has failed most of its runs for an hour.
  rule {
    name           = "TermStash probe failing on its own"
    condition      = "probe_degraded"
    for            = "1h"
    no_data_state  = "OK"
    exec_err_state = "Error"

    data {
      ref_id         = "worst_probe_success"
      datasource_uid = data.grafana_data_source.prometheus.uid
      relative_time_range {
        from = 3600
        to   = 0
      }
      model = jsonencode({
        refId   = "worst_probe_success"
        expr    = "min(sum by (probe) (increase(probe_all_success_sum{${local.probe_selector}}[1h])) / sum by (probe) (increase(probe_all_success_count{${local.probe_selector}}[1h])))"
        instant = true
      })
    }

    data {
      ref_id         = "probe_degraded"
      datasource_uid = "__expr__"
      relative_time_range {
        from = 0
        to   = 0
      }
      model = jsonencode({
        refId      = "probe_degraded"
        type       = "threshold"
        expression = "worst_probe_success"
        conditions = [{ evaluator = { type = "lt", params = [0.5] } }]
      })
    }

    annotations = {
      summary     = "One TermStash probe has failed most of its runs for an hour; the SLO now has no spare probe."
      runbook_url = "${var.runbook_url}#probe-failing-on-its-own"
    }
    labels = {
      service  = "termstash"
      severity = "warning"
    }
  }
}

resource "grafana_contact_point" "email" {
  name = "termstash-email"

  email {
    addresses               = [var.alert_email]
    disable_resolve_message = false
  }
}

# The notification policy is a single tree per stack, and this stack exists
# only for TermStash, so Terraform owns all of it.
resource "grafana_notification_policy" "root" {
  contact_point   = grafana_contact_point.email.name
  group_by        = ["alertname"]
  group_wait      = "30s"
  group_interval  = "5m"
  repeat_interval = "4h"
}
