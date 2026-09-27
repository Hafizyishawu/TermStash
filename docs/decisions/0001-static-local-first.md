# 0001: Static, local-first app with file-based sharing

## Context

CommandPad stores commands people run against production systems. The saved
text often includes hostnames and cluster names. Sometimes it includes
credentials. It needs to be shareable with colleagues, work without a
network, and be cheap to extend as adoption grows.

## Decision

- It ships as static files with no backend. Commands live in each person's
  browser storage.
- Sharing uses exported JSON packs that travel through normal channels, most
  usefully a git repository with pull-request review. There is no sync server
  and there are no accounts.
- The page declares `connect-src 'none'`, so it cannot make network requests.
- Titles are suggested by a local rule-based parser, not a language model,
  because a model call would send command text to a third party.
- Export refuses commands that match the secret detector. Import rejects a
  malformed pack as a whole and previews every command.

## Consequences

- There is nothing to operate, secure or pay for on the server side. The attack
  surface is the page itself and the packs people choose to import.
- Commands do not follow a person between browsers. The backup nudge and packs
  work around this. Real sync would need a backend, auth and an encryption
  design, and it gets its own ADR if adoption justifies it.
- Pack review in git gives teams history, ownership and approval for free, but
  it assumes colleagues are comfortable with pull requests.
- Name quality is limited to the tools the parser knows. Unknown tools get a
  plain but accurate fallback. An opt-in model-based namer could be added
  later behind explicit consent, with its own connect-src exception.
