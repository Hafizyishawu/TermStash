output "check_id" {
  description = "Synthetic Monitoring check ID for the home page check."
  value       = grafana_synthetic_monitoring_check.home.id
}

output "slo_uuid" {
  description = "UUID of the availability SLO."
  value       = grafana_slo.availability.uuid
}

output "probe_runs_per_month" {
  description = "Approximate synthetic test runs per month, to compare with the free tier's 100k."
  value       = floor(length(var.probe_names) * 30 * 24 * 3600 / var.check_frequency_seconds)
}
