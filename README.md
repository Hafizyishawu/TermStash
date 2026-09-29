# CommandPad

A notepad for the commands you use often but cannot remember. Paste a command
and CommandPad names it. When you need it again, one click copies it.

- **Placeholders.** Save `kubectl logs -f {{pod}} -n {{namespace:default}}`. When
  you copy, CommandPad asks for `pod` and `namespace`. Placeholder values are
  held in memory for the tab and never saved.
- **Automatic names.** Titles are suggested from what the command does, for
  example `kubectl: logs for <pod> in <namespace>` or `aws: s3 ls s3://bucket
  (profile prod)`. A local parser does this, so the command never leaves the
  browser.
- **Secret warnings.** A command that looks like it contains a credential gets a
  warning when you save it, and it cannot be exported.
- **Packs.** Commands are shared as `.commandpad.json` files. Import shows every
  command before anything is added.
- **Offline and local.** No backend, no accounts, no network requests. Once it
  has loaded over http(s), a service worker keeps it working offline.

## Using it

Open the hosted page, or run it locally:

```bash
npm run serve
```

Then open http://127.0.0.1:8765. Serve it over http(s) or localhost rather
than opening `index.html` from disk, because offline support and the modern
clipboard API are not available to `file://` pages.

| Key | Action |
| --- | --- |
| `/` | Focus search |
| `Up` / `Down` | Move the selection |
| `Enter` | Copy the selected command, filling placeholders first |
| `Cmd+E` or `Cmd+Enter` (`Ctrl` elsewhere) | Edit the selected command |
| `Cmd+Backspace` | Delete the selected command |
| `Esc` in search | Clear search |
| `n` | New command |
| Paste anywhere | Search for the pasted text. If nothing matches, `Enter` saves it as a new command, named automatically |
| `Cmd+Enter` in the editor | Save |

Search matches title, command, description and tags. Every word must match.
`#k8s` matches the tag exactly. Results are ordered by how often you copy them.

## Built-in suggestions

CommandPad ships with about 1,400 read-only commands for kubectl, AWS, Docker,
Helm, Terraform, GitHub CLI, PromQL, LogQL, SQL and more. A few starters show on
an empty notepad. All of them turn up in search, grouped below your own
matches. Pasting a command also surfaces similar suggestions, judged on the
command's shape rather than your specific values.

Suggestions are never saved unless you choose **Save** (`Cmd+S`) or
**Customize** (`Cmd+E`, opens the editor first). They are never counted, never
exported and never backed up, so they cannot clutter your notepad. Copying one
works like copying a saved command, placeholders included.

The catalog in `src/catalog.js` is generated from a directory of markdown
reference docs, one entry per fenced shell, PromQL, LogQL or SQL block:

```bash
node scripts/build-catalog.js --source path/to/docs --rules path/to/rules.json
```

The rules file sits with the docs, not in this repository. It lists ordered
regex replacements that turn environment-specific names into
`{{placeholders}}`, plus forbidden patterns. If any forbidden pattern survives,
the build writes nothing. `test/catalog.test.js` adds the checks that don't
need the rules file, and CI runs them: no secrets, no internal hostnames or
email addresses, no leftover `<angle>` markers, and valid placeholders.

## Placeholders

`{{name}}` or `{{name:default}}`. Names can contain letters, digits, `_`, `.`
and `-`. A name used twice is asked for once. Placeholders whose names contain
`pass`, `secret`, `token`, `key`, `credential` or `auth` get a masked input.

Values are inserted exactly as typed. CommandPad does not shell-quote them.

## Sharing commands with a team

1. Choose **Export** and download a pack. Commands flagged as possible secrets
   are left out and listed.
2. Commit the pack to a shared repository, such as this repo's `packs/`
   directory, and open a pull request. Review is where a team agrees on which
   commands are canonical.
3. Colleagues choose **Import** and pick the file. Duplicates are skipped, and
   anything flagged as a possible secret starts unchecked.

To enforce this in any repository that stores packs, run the scanner in CI:

```bash
node scripts/check-packs.js path/to/packs
```

It exits non-zero if a pack is malformed or contains a possible secret.

## Where your data lives

Commands are stored in this browser's local storage, under this site's origin.
They are not synced between browsers or devices. Clearing site data deletes
them. After a while CommandPad reminds you to export a backup. That backup is a
normal pack, which you can import on a new machine.

If stored data cannot be read, for example after a downgrade, CommandPad stops
saving so nothing gets overwritten. It then offers the raw data as a download.

## Security model

- **No network access.** The Content-Security-Policy sets `connect-src 'none'`
  and allows only same-origin scripts. The page cannot send commands anywhere.
- **Untrusted packs.** Imports are parsed strictly: known fields only, size and
  count limits, and a whole pack is rejected if any entry in it is invalid.
  Everything is rendered as text, never as HTML.
- **Secret detection is a guard rail, not a guarantee.** It catches common
  credential formats and inline assignments. It is measured against a labeled
  corpus in `test/fixtures/secret-corpus.js`. Use placeholders or environment
  variables (`$TOKEN`) for anything sensitive.
- **Storage is not encrypted.** Anyone with access to your browser profile can
  read saved commands.

## Hosting

```bash
npm run build
```

This writes the deployable site to `dist/`, which is only the files the
browser needs. Deploy `dist/`, never the repository root, because the root
would publish tests, docs and CI config. The build fails if the service worker
precaches a file that is missing from the output.

Hosted at commandpad.me on Cloudflare Pages:

| Setting | Value |
| --- | --- |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Environment variable | `NODE_VERSION=20` |

`_headers` sets the security headers, which Cloudflare Pages and Netlify both
read. It adds `frame-ancestors 'none'`, which only works as a header and stops
another site from framing CommandPad to trick people into clicking. It also
marks `sw.js` as `no-cache`, so a deploy reaches people on their next visit.
Anything served from `dist/` is readable by every visitor, since browsers
download the full app source.

## Development

No dependencies. Node 20+ runs the tests, and Python serves the page locally.

```bash
npm test
```

```bash
npm run check
```

```bash
npm run check-packs
```

| Path | Purpose |
| --- | --- |
| `src/placeholders.js` | Parse and fill `{{placeholders}}` |
| `src/secrets.js` | Credential detection rules |
| `src/namer.js` | Title suggestion from command text |
| `src/commands.js` | Command model, search, persistence |
| `src/packs.js` | Pack export, strict import parsing, import planning |
| `src/app.js` | UI |
| `sw.js` | Offline support, network-first |
| `scripts/check-packs.js` | CI scanner for shared packs |

The detector and the namer are both measured against labeled corpora
(`test/fixtures/`). The tests print precision, recall and accuracy, and they
fail on any regression. When you find a false positive, a missed secret or a
bad name in real use, add it to the corpus first, then change the rules.

Decisions are recorded in `docs/decisions/`.

## License

TermStash is licensed under the Functional Source License 1.1 with an Apache 2.0 future license (FSL-1.1-ALv2). You may use, modify and redistribute it for any purpose except a competing product or service, and each version becomes available under the Apache License 2.0 two years after its release. See `LICENSE`.
