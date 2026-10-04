output "pages_subdomain" {
  description = "The project's *.pages.dev hostname, used as the CNAME target and for preview deployments."
  value       = cloudflare_pages_project.site.subdomain
}

output "pages_project_name" {
  description = "Pages project name the CI deploy job uploads to."
  value       = cloudflare_pages_project.site.name
}

output "dnssec_ds_record" {
  description = "DS record for the zone. Published automatically by Cloudflare Registrar; shown so it can be checked against the registry."
  value       = cloudflare_zone_dnssec.site.ds
}
