// Detects credentials pasted into commands. Commands are shared as packs, so a
// single token saved by one person leaks to everyone who imports it. Values
// that are clearly references rather than secrets ({{placeholder}}, $VARIABLE,
// <angle-bracket>, $(subshell)) are deliberately not flagged: they are exactly
// what people should be writing instead.
//
// Detection quality is measured against test/fixtures/secret-corpus.json. Any
// rule change must keep that corpus at full precision and recall, and any new
// false positive or miss seen in practice becomes a corpus entry first.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else (root.CommandPad = root.CommandPad || {}).secrets = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const NOT_A_REFERENCE = "(?![{$<(])";

  const RULES = [
    { id: "private-key", label: "Private key block", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
    { id: "aws-access-key", label: "AWS access key ID", pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
    { id: "github-token", label: "GitHub token", pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})\b/ },
    { id: "gitlab-token", label: "GitLab token", pattern: /\bglpat-[A-Za-z0-9_-]{20,}\b/ },
    { id: "slack-token", label: "Slack token", pattern: /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/ },
    { id: "stripe-key", label: "Stripe live key", pattern: /\b[rs]k_live_[A-Za-z0-9]{16,}\b/ },
    { id: "google-api-key", label: "Google API key", pattern: /\bAIza[0-9A-Za-z_-]{35}\b/ },
    { id: "npm-token", label: "npm token", pattern: /\bnpm_[A-Za-z0-9]{36}\b/ },
    { id: "llm-api-key", label: "AI provider API key", pattern: /\bsk-(?:ant-[A-Za-z0-9_-]{20,}|proj-[A-Za-z0-9_-]{20,}|[A-Za-z0-9]{32,})/ },
    { id: "jwt", label: "JSON Web Token", pattern: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
    {
      id: "bearer-token",
      label: "Bearer token",
      pattern: new RegExp(`\\bbearer\\s+${NOT_A_REFERENCE}[A-Za-z0-9._~+/-]{20,}=*`, "i"),
    },
    {
      id: "basic-auth",
      label: "Basic auth credentials",
      pattern: new RegExp(`\\bbasic\\s+${NOT_A_REFERENCE}[A-Za-z0-9+/]{16,}={0,2}(?![A-Za-z0-9+/=])`, "i"),
    },
    {
      id: "url-credentials",
      label: "Password in URL",
      pattern: new RegExp(`\\b[a-z][a-z0-9+.-]*://[^\\s:/@]+:${NOT_A_REFERENCE}[^\\s@/]{3,}@`, "i"),
    },
    {
      id: "user-password-flag",
      label: "Password in -u/--user flag",
      pattern: new RegExp(`(?:^|\\s)(?:-u|--user)\\s+["']?[^\\s:"']+:${NOT_A_REFERENCE}[^\\s"']{3,}`),
    },
    {
      id: "secret-assignment",
      label: "Password, token or key assigned inline",
      pattern: new RegExp(
        `(?:password|passwd|secret|token|api[_-]?key|access[_-]?key)["']?\\s*[=:]\\s*["']?${NOT_A_REFERENCE}[^\\s"'{}&;|]{6,}`,
        "i",
      ),
    },
    {
      id: "secret-flag",
      label: "Password, token or key passed as a flag",
      pattern: new RegExp(`--(?:password|passwd|token|api-key|secret)\\s+["']?${NOT_A_REFERENCE}(?!-)[^\\s"']{6,}`, "i"),
    },
  ];

  function scan(text) {
    if (typeof text !== "string" || text === "") return [];
    return RULES.filter((rule) => rule.pattern.test(text)).map(({ id, label }) => ({ id, label }));
  }

  return { scan, RULES };
});
