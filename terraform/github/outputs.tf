output "repository_url" {
  description = "Web URL of the managed repository."
  value       = github_repository.termstash.html_url
}

output "protections_active" {
  description = "Whether the ruleset and production environment are in place. False while the repository is private on GitHub Free."
  value       = local.public
}
