output "repository_url" {
  description = "Web URL of the managed repository."
  value       = github_repository.termstash.html_url
}

output "protections_active" {
  description = "Whether the ruleset, production environment and its branch policy were actually created. False while the repository is private on GitHub Free."
  # Server-assigned ids exist only once GitHub has created each resource, so
  # this cannot report true from intent alone.
  value = alltrue([
    one(github_repository_ruleset.default_branch[*].ruleset_id) != null,
    one(github_repository_environment.production[*].id) != null,
    one(github_repository_environment_deployment_policy.production_main[*].policy_id) != null,
  ])
}
