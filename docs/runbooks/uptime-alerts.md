# Uptime alerts

Grafana Cloud Synthetic Monitoring requests https://termstash.app/ from
London, Frankfurt and North Virginia every two minutes. A run passes only if
the page returns 200 over TLS, contains "TermStash", and its
Content-Security-Policy still has `connect-src 'none'`. Everything is defined
in `terraform/monitoring`.

The objective: over 28 days, a majority of probes (two of three) pass 99.9%
of the time, about 40 minutes of failure. One probe failing on its own does
not count against it. Alerts arrive by email and link to the matching
section below.

## First five minutes, for any alert

1. Open https://termstash.app in a private window. Note what you see: an
   error page, the wrong content, or the app.
2. Check the headers: `curl -sI https://termstash.app/ | grep -i content-security-policy`
3. Grafana: Testing & synthetics, Synthetics, `termstash-home`. Look at which
   probes fail and which assertion: status code, body, header or TLS.
4. Cloudflare status (https://www.cloudflarestatus.com) and the Pages project's
   Deployments list: was there a deploy just before the failures started?

## Fast burn

The error budget would run out within days at the current failure rate: the
site is down or broken for most visitors now.

- **A deploy preceded it:** roll back in Cloudflare (Workers & Pages,
  `termstash`, Deployments, last good production deployment, Rollback), then
  follow `deploy-and-rollback.md` to revert in a pull request.
- **No deploy, all probes failing, Cloudflare reports an incident:** wait it
  out; there is nothing on our side to change. Note the window for the
  monthly review.
- **No deploy, Cloudflare healthy:** check DNS (`dig +short termstash.app`)
  and the latest `termstash-cloudflare` apply in HCP for an unexpected change.

## Slow burn

Majority failures are frequent enough to miss the objective this window, but
the site mostly works: intermittent errors across regions, or slow responses
timing out.

- Look for a pattern by time of day or by assertion, and check the
  Cloudflare analytics for 5xx responses.
- A single probe failing does not trigger this alert; it has its own warning
  below.

## Certificate expiring

The certificate the probes see expires within 14 days. Cloudflare should have
renewed it automatically. Check SSL/TLS, Edge Certificates in the Cloudflare
dashboard, and that the CAA records in `terraform/cloudflare` still include
the CA Cloudflare uses. Escalate to Cloudflare support if renewal is stuck.

## Probe failing on its own

One probe has failed most of its runs for an hour while the others pass. The
site is probably fine, but the SLO has lost its spare: one more failing probe
would count as an outage. Compare that probe's failures with the others on
the check page; if it persists for a day, replace it in `probe_names` with
another region.

## Probe data missing

No probe has reported for about 15 minutes. Probes report a result whether a run
passes or fails, so this is the monitoring stopping, not the site: until it
reports again, outages will not alert.

- Check that `termstash-home` is enabled in Synthetics and the Grafana Cloud
  status page.
- Probes publish with the metrics publisher token Synthetic Monitoring
  created when it was initialised (Synthetics, Config). If it was revoked or
  expired, regenerate it there.
- `GRAFANA_SM_ACCESS_TOKEN` is only Terraform's token for managing checks; if
  it expires, HCP plans for `termstash-monitoring` fail, but probes keep
  reporting.

## Changing the monitoring

All of it is Terraform in `terraform/monitoring`, applied through the
`termstash-monitoring` HCP workspace. Do not create or edit checks, SLOs or
contact points in the Grafana UI: the next apply would revert or duplicate
them.

The free tier allows 100,000 test runs a month. The `probe_runs_per_month`
output shows the current figure; keep it well under the limit when adding
probes or raising the frequency. A plan fails outright above 90,000 runs a
month, and `probe_names` must hold an odd number of probes, at least three.

Terraform's credentials are rotated every 90 days: the stack service
account token (`GRAFANA_AUTH`, Editor role) and the Synthetic Monitoring
access token (`GRAFANA_SM_ACCESS_TOKEN`). Either one expiring shows up as a
failed HCP plan, not as an alert.
