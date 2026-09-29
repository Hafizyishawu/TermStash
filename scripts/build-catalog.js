#!/usr/bin/env node
// Builds src/catalog.js, the built-in command suggestions, from a directory of
// markdown reference docs. Each fenced shell, PromQL, LogQL or SQL block
// becomes one entry, titled by the line of prose above it.
//
//   node scripts/build-catalog.js --source <docs-dir> --rules <rules.json>
//
// The rules file lives with the source docs, not in this repository, because
// it names the organisation-specific identifiers being generalised. It holds
// ordered regex replacements and a list of forbidden patterns. If any
// forbidden pattern survives generalisation, nothing is written: a partial
// scrub that ships is worse than a build that fails.
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const placeholders = require("../src/placeholders.js");
const secrets = require("../src/secrets.js");
const commands = require("../src/commands.js");

const OUTPUT = path.resolve(__dirname, "..", "src", "catalog.js");
const LANGUAGES = new Set(["bash", "sh", "shell", "promql", "logql", "sql"]);
const TOOL_BY_FILE = {
  aws_reference: "aws",
  database_reference: "database",
  docker_reference: "docker",
  elasticsearch_reference: "elasticsearch",
  "enterprise-monitoring-stack": "monitoring",
  github_cli_reference: "gh",
  gitops_reference: "gitops",
  helm_reference: "helm",
  kafka_reference: "kafka",
  kubectl_reference: "kubectl",
  log_investigation_reference: "logs",
  logql_reference: "logql",
  network_debugging_reference: "network",
  observability_reference: "observability",
  oncall_command_runbook: "oncall",
  policy_enforcement_reference: "policy",
  promql_reference: "promql",
  terraform_reference: "terraform",
};
// The empty notepad shows one short starter per tool. The first entry whose
// command matches the tool's preference wins; otherwise the first short one.
// aws prefers identity checks over "aws configure", which teaches static keys.
const STARTERS = [
  { tool: "kubectl", prefer: /^kubectl logs|^kubectl get pods/ },
  { tool: "docker", prefer: /^docker ps/ },
  { tool: "aws", prefer: /sts get-caller-identity|sso login/ },
  { tool: "helm", prefer: /^helm (list|ls)\b/ },
  { tool: "terraform", prefer: /^terraform plan/ },
  { tool: "gh", prefer: /^gh pr (list|status)/ },
  { tool: "promql", prefer: /rate\(/ },
  { tool: "logql", prefer: /error/i },
];
const MAX_STARTER_LENGTH = 90;
const MAX_TITLE_LENGTH = 120;

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) args[argv[i].replace(/^--/, "")] = argv[i + 1];
  if (!args.source || !args.rules) {
    console.error("usage: build-catalog.js --source <docs-dir> --rules <rules.json>");
    process.exit(2);
  }
  return args;
}

function loadRules(file) {
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  return {
    replacements: raw.replacements.map((r) => ({ regex: new RegExp(r.pattern, r.flags || "g"), replacement: r.replacement })),
    forbidden: raw.forbidden.map((pattern) => new RegExp(pattern, "i")),
  };
}

function generalise(text, rules) {
  return rules.replacements.reduce((current, rule) => current.replace(rule.regex, rule.replacement), text);
}

function cleanProse(line) {
  return line
    .replace(/^#+\s*/, "")
    .replace(/\*\*|__|`/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/:\s*$/, "")
    .trim();
}

// Doc-style <angle-name> markers become fillable {{placeholders}}. LogQL
// pattern expressions use <name> as capture syntax, so those are left alone.
function convertAnglePlaceholders(command) {
  if (/\bpattern\s+"/.test(command)) return command;
  return command.replace(/<([A-Za-z][A-Za-z0-9_-]*)>/g, (_, name) => `{{${name.replace(/-/g, "_")}}}`);
}

function isOnlyComments(command) {
  return command.split("\n").every((line) => !line.trim() || line.trim().startsWith("#") || line.trim().startsWith("--"));
}

function splitTitle(prose) {
  const [head, ...rest] = prose.replace(/\s+/g, " ").split(/\s+—\s+|\s+--\s+/);
  const title = head.length > MAX_TITLE_LENGTH ? head.slice(0, MAX_TITLE_LENGTH - 1).trimEnd() + "…" : head;
  return { title, note: rest.join(" — ") };
}

function stableId(tool, command) {
  let hash = 0x811c9dc5;
  for (const ch of `${tool}\n${command}`) hash = Math.imul(hash ^ ch.charCodeAt(0), 0x01000193) >>> 0;
  return `c-${hash.toString(36)}`;
}

// Author and date lines such as "**Team | Name | Month Year**" describe the
// document, not the command below them.
function isByline(line) {
  return /^\*\*[^*]*\s\|\s[^*]*\*\*$/.test(line);
}

function extractBlocks(file) {
  const blocks = [];
  let section = "";
  let prose = "";
  let fence = null;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const fenceMatch = line.match(/^```\s*([A-Za-z]*)\s*$/);
    if (fence) {
      if (fenceMatch && fenceMatch[1] === "") {
        blocks.push({ ...fence, command: fence.lines.join("\n") });
        fence = null;
        prose = "";
      } else fence.lines.push(line);
      continue;
    }
    if (fenceMatch) {
      fence = { language: fenceMatch[1].toLowerCase(), section, prose, lines: [] };
      continue;
    }
    const trimmed = line.trim();
    if (/^##\s/.test(trimmed)) {
      section = cleanProse(trimmed);
      prose = "";
    } else if (/^###+\s/.test(trimmed)) {
      prose = cleanProse(trimmed);
    } else if (trimmed && !/^(\||---|\*Last updated|>|- \[)/.test(trimmed) && !isByline(trimmed)) {
      prose = cleanProse(trimmed);
    }
  }
  return blocks;
}

function buildEntries(source, rules) {
  const files = fs.readdirSync(source).filter((f) => f.endsWith(".md")).sort();
  const seen = new Set();
  const entries = [];
  for (const file of files) {
    const base = file.replace(/\.md$/, "");
    const tool = TOOL_BY_FILE[base] || base.replace(/_reference$/, "");
    for (const block of extractBlocks(path.join(source, file))) {
      if (!LANGUAGES.has(block.language)) continue;
      const command = convertAnglePlaceholders(generalise(block.command, rules)).replace(/\s+$/, "");
      if (!command.trim() || isOnlyComments(command)) continue;
      const key = commands.dedupeKey(command);
      if (seen.has(key)) continue;
      seen.add(key);
      const prose = generalise(block.prose || block.section || tool, rules);
      const { title, note } = splitTitle(prose);
      const language = ["sh", "shell"].includes(block.language) ? "bash" : block.language;
      const tags = [...new Set([tool, language === "bash" ? null : language].filter(Boolean))];
      entries.push({
        id: stableId(tool, command),
        title,
        command,
        description: note,
        tags,
        tool,
        language,
        section: generalise(block.section, rules),
      });
    }
  }
  for (const { tool, prefer } of STARTERS) {
    const eligible = entries.filter((e) =>
      e.tool === tool && !e.command.includes("\n") && e.command.length <= MAX_STARTER_LENGTH && e.title.length <= 60);
    const starter = eligible.find((e) => prefer.test(e.command)) || eligible[0];
    if (starter) starter.starter = true;
  }
  return entries;
}

function verify(entries, rules) {
  const problems = [];
  const ids = new Set();
  for (const entry of entries) {
    const text = [entry.title, entry.command, entry.description, entry.section].join("\n");
    for (const pattern of rules.forbidden) if (pattern.test(text)) problems.push(`${entry.id}: forbidden pattern ${pattern} in "${entry.title}"`);
    for (const finding of secrets.scan(entry.command)) problems.push(`${entry.id}: possible secret (${finding.id}) in "${entry.title}"`);
    for (const problem of commands.validate(entry)) problems.push(`${entry.id}: ${problem}`);
    if (ids.has(entry.id)) problems.push(`${entry.id}: duplicate id`);
    ids.add(entry.id);
    placeholders.parse(entry.command);
  }
  return problems;
}

function render(entries) {
  const lines = entries.map((entry) => `    ${JSON.stringify(entry)},`).join("\n");
  return `// Generated by scripts/build-catalog.js. Do not edit by hand; rebuild instead.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else (root.CommandPad = root.CommandPad || {}).catalog = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  return Object.freeze([
${lines}
  ]);
});
`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const rules = loadRules(args.rules);
  const entries = buildEntries(args.source, rules);
  const problems = verify(entries, rules);
  if (problems.length) {
    console.error(problems.join("\n"));
    console.error(`build-catalog: ${problems.length} problem(s); ${OUTPUT} was not written`);
    process.exit(1);
  }
  fs.writeFileSync(OUTPUT, render(entries));
  const byTool = entries.reduce((counts, e) => ({ ...counts, [e.tool]: (counts[e.tool] || 0) + 1 }), {});
  console.log(`build-catalog: ${entries.length} entries, ${entries.filter((e) => e.starter).length} starters`);
  console.log(Object.entries(byTool).map(([tool, count]) => `${tool}=${count}`).join(" "));
}

main();
