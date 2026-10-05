data "cloudflare_zone" "site" {
  filter = {
    name = var.domain
  }
}

locals {
  # id is the computed identifier; zone_id on this data source is an optional
  # input that a filter lookup is not guaranteed to populate.
  zone_id = data.cloudflare_zone.site.id
}

# Direct Upload project: no source block, so Cloudflare never builds or
# deploys on its own. Deployments come only from the gated CI pipeline. A
# project created with the dashboard's Git integration cannot be switched to
# this mode later, which is why the project is defined here.
resource "cloudflare_pages_project" "site" {
  account_id        = var.account_id
  name              = var.pages_project_name
  production_branch = var.production_branch

  lifecycle {
    prevent_destroy = true
  }
}

resource "cloudflare_pages_domain" "apex" {
  account_id   = var.account_id
  project_name = cloudflare_pages_project.site.name
  name         = var.domain
}

# Apex CNAME to the Pages subdomain; Cloudflare flattens it at the edge.
resource "cloudflare_dns_record" "apex" {
  zone_id = local.zone_id
  name    = var.domain
  type    = "CNAME"
  content = cloudflare_pages_project.site.subdomain
  proxied = true
  ttl     = 1
  comment = "Cloudflare Pages: ${cloudflare_pages_project.site.name}. Managed by Terraform."

  # Pages must know the custom domain before traffic arrives for it, or the
  # apex serves errors until both exist.
  depends_on = [cloudflare_pages_domain.apex]
}

# Only the listed certificate authorities may issue for this domain, so a
# mis-issued certificate from any other CA is refused at issuance.
resource "cloudflare_dns_record" "caa_issue" {
  for_each = toset(var.allowed_certificate_authorities)

  zone_id = local.zone_id
  name    = var.domain
  type    = "CAA"
  ttl     = 1
  data = {
    flags = 0
    tag   = "issue"
    value = each.value
  }
  comment = "Managed by Terraform."
}

resource "cloudflare_dns_record" "caa_issuewild" {
  for_each = toset(var.allowed_certificate_authorities)

  zone_id = local.zone_id
  name    = var.domain
  type    = "CAA"
  ttl     = 1
  data = {
    flags = 0
    tag   = "issuewild"
    value = each.value
  }
  comment = "Managed by Terraform."
}

# The domain sends no email. A null MX, a fail-all SPF and a rejecting DMARC
# policy stop anyone sending mail that claims to be from termstash.app.
resource "cloudflare_dns_record" "null_mx" {
  zone_id  = local.zone_id
  name     = var.domain
  type     = "MX"
  content  = "."
  priority = 0
  ttl      = 1
  comment  = "RFC 7505 null MX: this domain accepts no mail. Managed by Terraform."
}

resource "cloudflare_dns_record" "spf" {
  zone_id = local.zone_id
  name    = var.domain
  type    = "TXT"
  content = "\"v=spf1 -all\""
  ttl     = 1
  comment = "No host may send mail for this domain. Managed by Terraform."
}

resource "cloudflare_dns_record" "dmarc" {
  zone_id = local.zone_id
  name    = "_dmarc.${var.domain}"
  type    = "TXT"
  content = "\"v=DMARC1; p=reject; sp=reject; adkim=s; aspf=s\""
  ttl     = 1
  comment = "Reject all unauthenticated mail. Managed by Terraform."
}

# DNSSEC signs the zone so resolvers can reject forged answers. With the
# domain on Cloudflare Registrar the DS record is published automatically.
resource "cloudflare_zone_dnssec" "site" {
  zone_id = local.zone_id
  status  = "active"
}

locals {
  zone_settings = {
    always_use_https         = "on"
    automatic_https_rewrites = "on"
    min_tls_version          = "1.2"
    tls_1_3                  = "on"
    ssl                      = "strict"
  }
}

resource "cloudflare_zone_setting" "site" {
  for_each = local.zone_settings

  zone_id    = local.zone_id
  setting_id = each.key
  value      = each.value
}
