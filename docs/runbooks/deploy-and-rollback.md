# Deploy and rollback

## How a deploy happens

1. A pull request merges to `main`.
2. The `deploy` workflow's `build` job first runs `scripts/deploy-preflight.sh`,
   which fails the run before any approval is requested if the account ID or
   project name is missing or malformed. It then runs the checks and tests,
   builds `dist/`, and stores it as the `site` artifact.
3. The `deploy` job waits on the `production` environment. Approve it from the
   workflow run page (Review deployments). Only runs from `main` can be
   approved.
4. `scripts/deploy-pages.sh` uploads the artifact with wrangler, pinned in
   `deploy/package-lock.json`, tagged with the commit SHA and message.
5. `scripts/verify-deploy.sh` fails the run unless every built file is served
   byte for byte at https://termstash.app and the security headers are in
   force, including the service worker's own CSP.

The audit trail: the GitHub deployment records the commit, the approver and
the time; the Pages deployment records the same commit SHA.

To redeploy `main` without a new commit, for example after rotating the token,
run the workflow manually (Actions, deploy, Run workflow on `main`).

## After the first deploy, and after any service worker change

The verify script cannot run a browser, so check the service worker by hand
until the end-to-end suite covers it. In Chrome on https://termstash.app,
open DevTools, Application:

- Service workers: `sw.js` shows as activated and running.
- Cache storage: `termstash-shell` lists every file in `SHELL` in `sw.js`.
- Network, set to Offline, then reload: the app still loads.

## Rollback

The service worker is network-first, so visitors get a rolled-back version on
their next load.

**Normal path, reviewed:** revert the bad change in a pull request, merge it,
approve the deploy. This keeps `main` and production in step.

**Fast path, during an incident:** Cloudflare dashboard, Workers & Pages,
`termstash`, Deployments, choose the last good production deployment, then
Rollback. This is a console action, so record who, when and why in the
incident notes, and open the revert pull request straight after: until it
merges, the next deploy from `main` brings the bad version back.

## Deploy token

`CLOUDFLARE_API_TOKEN` on the `production` environment is the only deploy
value set by hand; the account ID and project name are repository variables
managed in `terraform/github`, readable by the build job's preflight. Until
the follow-up change removes them, production environment variables of the
same names also exist and take precedence in the deploy job; keep both equal.
The
token has Account, Cloudflare Pages, Edit, on this account only, and nothing
else: it can publish a build but cannot change DNS, TLS or redirects.

Rotate before it expires:

1. Create a new token with the same single permission and an expiry.
2. Set it: `gh secret set CLOUDFLARE_API_TOKEN --env production --repo Hafizyishawu/TermStash`
3. Run the deploy workflow manually on `main` and approve it; a green run
   proves the new token works.
4. Delete the old token in Cloudflare.

If the token leaks, delete it in Cloudflare first, which stops it at once,
then rotate as above. Review the project's deployment list for uploads you
did not approve and roll back any.

## When a deploy fails

- **Deploy step, authentication error:** the token is expired, deleted or
  lacks Pages edit. Rotate it.
- **Preflight, variable not set or malformed:** the `terraform/github`
  repository variables are missing or wrong. Check that workspace's latest
  apply; no approval was requested, so nothing else needs undoing.
- **Verify step, files do not match:** wait for the retries to finish; if it
  still fails, compare the Pages deployment list with the run's commit SHA,
  and redeploy or roll back.
- **Verify step, header check failed:** `_headers` was not applied as
  intended. The site is live with weaker headers, so roll back, then fix
  `_headers` in a pull request.

## Updating the deploy tool

wrangler and its dependencies are pinned in `deploy/package-lock.json`.

- **Voluntary upgrades** wait until a release has been out for about two
  weeks. Most compromised or broken releases are found and pulled within
  days, so waiting costs little.
- **Dependabot security updates** merge once CI passes and the new versions
  carry verified npm provenance: after `npm ci --ignore-scripts` in `deploy/`,
  `npm audit signatures` must report the attestations as verified, and the
  package page on npmjs.com must show the provenance source as the expected
  repository (`cloudflare/workers-sdk` for wrangler). Waiting there keeps a
  known flaw in place, which is the larger risk.

The deploy that follows the merge verifies only that the files now live are
the tested build. It cannot show what the deploy tool did with the token
while it ran, so if a release is later found to be compromised, roll back
and rotate the token as well.
