// Suggests a title for a command by reading it, entirely locally. Commands
// never leave the browser, so this is a rule-based parser rather than a call
// to a language model: deterministic, offline, and measurable against the
// labeled set in test/fixtures/naming-corpus.json.
//
// Output shape is "<tool>: <action>[ qualifiers][, piped to X][ (+N more steps)]".
// Unknown tools fall back to the tool name plus its first few arguments, which
// is a worse name but never a wrong one.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else (root.CommandPad = root.CommandPad || {}).namer = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const MAX_TITLE_LENGTH = 80;
  const PLACEHOLDER = /\{\{\s*([A-Za-z_][A-Za-z0-9_.-]*)\s*(?::[^}]*)?\}\}/g;

  function tokenize(input) {
    const source = input.replace(/\\\r?\n/g, " ");
    const tokens = [];
    let current = "";
    let inWord = false;
    let quote = null;
    const flush = () => {
      if (inWord) tokens.push({ word: current });
      current = "";
      inWord = false;
    };
    for (let i = 0; i < source.length; i++) {
      const ch = source[i];
      if (quote) {
        if (ch === quote) quote = null;
        else if (ch === "\\" && quote === '"' && i + 1 < source.length) current += source[++i];
        else current += ch;
        continue;
      }
      if (ch === "'" || ch === '"') {
        quote = ch;
        inWord = true;
        continue;
      }
      if (ch === "\\" && i + 1 < source.length) {
        current += source[++i];
        inWord = true;
        continue;
      }
      const pair = source.slice(i, i + 2);
      if (pair === "&&" || pair === "||") {
        flush();
        tokens.push({ op: pair });
        i++;
        continue;
      }
      if (ch === "|" || ch === ";" || ch === "\n") {
        flush();
        tokens.push({ op: ch === "\n" ? ";" : ch });
        continue;
      }
      if (/\s/.test(ch)) {
        flush();
        continue;
      }
      current += ch;
      inWord = true;
    }
    flush();
    return tokens;
  }

  function splitSegments(tokens) {
    const segments = [{ words: [], joinedBy: null }];
    for (const token of tokens) {
      if (token.op) segments.push({ words: [], joinedBy: token.op });
      else segments[segments.length - 1].words.push(token.word);
    }
    return segments.filter((segment) => segment.words.length);
  }

  // Wrappers run another command; the interesting program is what they wrap.
  const WRAPPERS = {
    sudo: new Set(["-u", "-g", "-C", "-h"]),
    env: new Set(["-u"]),
    watch: new Set(["-n"]),
    nice: new Set(["-n"]),
    time: new Set(),
    nohup: new Set(),
    exec: new Set(),
    command: new Set(),
    caffeinate: new Set(),
  };

  function stripWrappers(words) {
    let rest = words.slice();
    for (;;) {
      if (!rest.length) return rest;
      const head = rest[0];
      if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(head)) {
        rest = rest.slice(1);
        continue;
      }
      const name = basename(head);
      if (name === "timeout") {
        let i = 1;
        while (i < rest.length && rest[i].startsWith("-")) i++;
        rest = rest.slice(i + 1);
        continue;
      }
      if (!WRAPPERS[name]) return rest;
      let i = 1;
      while (i < rest.length && rest[i].startsWith("-")) i += WRAPPERS[name].has(rest[i]) ? 2 : 1;
      if (name === "env") while (i < rest.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(rest[i])) i++;
      rest = rest.slice(i);
    }
  }

  function basename(path) {
    const parts = String(path).split("/");
    return parts[parts.length - 1] || path;
  }

  function show(word) {
    return word === undefined ? "" : String(word).replace(PLACEHOLDER, "<$1>");
  }

  function parseArgs(words, valued, options = {}) {
    const positionals = [];
    const flags = new Map();
    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      if (word === "--") break;
      if (word.startsWith("--") && word.length > 2) {
        const eq = word.indexOf("=");
        if (eq > 0) flags.set(word.slice(0, eq), word.slice(eq + 1));
        else if ((valued.has(word) || (options.longFlagsTakeValue && !options.booleans?.has(word))) &&
                 i + 1 < words.length && !words[i + 1].startsWith("-")) flags.set(word, words[++i]);
        else flags.set(word, true);
      } else if (word.startsWith("-") && word.length > 1 && !/^-\d/.test(word)) {
        if (valued.has(word) && i + 1 < words.length && !words[i + 1].startsWith("-")) flags.set(word, words[++i]);
        else {
          flags.set(word, true);
          if (!word.startsWith("--")) for (const ch of word.slice(1)) flags.set("-" + ch, flags.get("-" + ch) || true);
        }
      } else positionals.push(word);
    }
    return { positionals, flags };
  }

  function flag(flags, ...names) {
    for (const name of names) {
      const value = flags.get(name);
      if (typeof value === "string") return value;
    }
    return undefined;
  }

  function hasFlag(flags, ...names) {
    return names.some((name) => flags.has(name));
  }

  function kubernetesQualifiers(flags) {
    const parts = [];
    if (hasFlag(flags, "-A", "--all-namespaces")) parts.push("in all namespaces");
    else {
      const namespace = flag(flags, "-n", "--namespace");
      if (namespace) parts.push(`in ${show(namespace)}`);
    }
    const context = flag(flags, "--context", "--kube-context");
    if (context) parts.push(`on ${show(context)}`);
    return parts;
  }

  const KUBECTL_VALUED = ["-n", "--namespace", "--context", "--kubeconfig", "-l", "--selector", "-o", "--output",
    "-c", "--container", "--tail", "--since", "--field-selector", "--replicas", "-k", "--kustomize"];
  const KUBECTL_FILE_VERBS = new Set(["apply", "create", "delete", "replace", "diff"]);

  function kubectl(words) {
    const base = new Set(KUBECTL_VALUED);
    let { positionals, flags } = parseArgs(words, base);
    const verb = positionals[0];
    if (KUBECTL_FILE_VERBS.has(verb)) ({ positionals, flags } = parseArgs(words, new Set([...base, "-f", "--filename"])));
    const [, first, second] = positionals.map(show);
    let action;
    const file = flag(flags, "-f", "--filename");
    const kustomization = flag(flags, "-k", "--kustomize");
    switch (verb) {
      case "get":
        action = second ? `get ${first} ${second}` : `list ${first || "resources"}`;
        break;
      case "logs":
        action = `logs for ${first}`;
        break;
      case "exec":
        action = `exec into ${first}`;
        break;
      case "config":
        action = first === "use-context" && second ? `switch context to ${second}` : ["config", first, second].filter(Boolean).join(" ");
        break;
      case "scale": {
        const replicas = flag(flags, "--replicas");
        action = `scale ${first}${replicas ? ` to ${show(replicas)}` : ""}`;
        break;
      }
      default:
        if (KUBECTL_FILE_VERBS.has(verb) && file) action = `${verb} ${show(basename(file))}`;
        else if (KUBECTL_FILE_VERBS.has(verb) && kustomization) action = `${verb} kustomization ${show(kustomization)}`;
        else action = [verb, first, second].filter(Boolean).join(" ");
    }
    return { action, qualifiers: kubernetesQualifiers(flags) };
  }

  const DOCKER_GROUPS = new Set(["compose", "image", "container", "volume", "network", "system", "buildx", "context",
    "builder", "swarm", "service", "stack"]);
  const DOCKER_VALUED = ["-v", "--volume", "-e", "--env", "--env-file", "-w", "--workdir", "-p", "--publish", "--name",
    "--network", "--entrypoint", "-u", "--user", "--platform", "-f", "--file", "--mount", "-l", "--label", "--tail",
    "--since", "--filter", "--project-name"];

  function docker(words) {
    const base = new Set(DOCKER_VALUED);
    let { positionals, flags } = parseArgs(words, base);
    if (positionals[0] === "build" || positionals[0] === "buildx") {
      ({ positionals, flags } = parseArgs(words, new Set([...base, "-t", "--tag"])));
    }
    const [verb, first, second] = positionals.map(show);
    if (DOCKER_GROUPS.has(verb)) return { action: [verb, first, second].filter(Boolean).join(" "), qualifiers: [] };
    const actions = {
      ps: "list containers",
      images: "list images",
      run: `run ${first}`,
      exec: `exec into ${first}`,
      logs: `logs for ${first}`,
      build: `build ${show(flag(flags, "-t", "--tag")) || first || "."}`,
    };
    return { action: actions[verb] || [verb, first].filter(Boolean).join(" "), qualifiers: [] };
  }

  function git(words) {
    const { positionals, flags } = parseArgs(words, new Set(["-C", "-c", "-m", "--message", "-b", "-B", "--author",
      "--format", "--pretty", "-n"]));
    const [verb, first, second] = positionals.map(show);
    const newBranch = flag(flags, "-b", "-B") || (verb === "switch" ? flag(flags, "-c") : undefined);
    let action;
    if ((verb === "checkout" || verb === "switch") && newBranch) action = `create branch ${show(newBranch)}`;
    else action = [verb, first, second].filter(Boolean).join(" ");
    if (hasFlag(flags, "--hard")) action += " (hard)";
    else if (hasFlag(flags, "--force", "--force-with-lease") || (verb === "push" && hasFlag(flags, "-f"))) action += " (force)";
    return { action, qualifiers: [] };
  }

  const AWS_BOOLEANS = new Set(["--recursive", "--dryrun", "--dry-run", "--no-cli-pager", "--debug", "--no-paginate",
    "--force", "--delete", "--no-verify-ssl", "--human-readable", "--summarize"]);

  function aws(words) {
    const { positionals, flags } = parseArgs(words, new Set(), { longFlagsTakeValue: true, booleans: AWS_BOOLEANS });
    const [service, operation, object] = positionals.map(show);
    const action = [service, operation && operation.replace(/-/g, " "), object].filter(Boolean).join(" ");
    const qualifiers = [];
    const region = flag(flags, "--region");
    const profile = flag(flags, "--profile");
    if (region) qualifiers.push(`in ${show(region)}`);
    if (profile) qualifiers.push(`(profile ${show(profile)})`);
    return { action, qualifiers };
  }

  function curl(words, program) {
    const { positionals, flags } = parseArgs(words, new Set(["-X", "--request", "-H", "--header", "-d", "--data",
      "--data-raw", "--data-binary", "--data-urlencode", "-o", "--output", "-u", "--user", "-A", "--user-agent", "-e",
      "--cacert", "--cert", "--key", "-w", "--write-out", "-F", "--form", "--connect-timeout", "-m", "--max-time",
      "--resolve", "--url", "-O", "--output-document"]));
    const url = flag(flags, "--url") || positionals[0] || "";
    const target = show(url).replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").replace(/[?#].*$/, "");
    if (program === "wget") return { action: `download ${target}`, qualifiers: [] };
    const hasBody = hasFlag(flags, "-d", "--data", "--data-raw", "--data-binary", "--data-urlencode", "-F", "--form");
    const method = (flag(flags, "-X", "--request") || (hasFlag(flags, "-I", "--head") ? "HEAD" : hasBody ? "POST" : "GET")).toUpperCase();
    return { action: `${method} ${target}`, qualifiers: [] };
  }

  function ssh(words) {
    const { positionals, flags } = parseArgs(words, new Set(["-i", "-p", "-l", "-o", "-F", "-J", "-L", "-R", "-D", "-W", "-b", "-c"]));
    const destination = show(positionals[0]);
    const tunnelled = hasFlag(flags, "-L", "-R", "-D");
    return { action: `${tunnelled ? "tunnel via" : "connect to"} ${destination}`, qualifiers: [] };
  }

  function copyTool(words, verb) {
    const { positionals } = parseArgs(words, new Set(["-i", "-P", "-e", "-o", "--exclude", "--include", "-F"]));
    if (positionals.length < 2) return { action: `${verb} ${show(positionals[0])}`.trim(), qualifiers: [] };
    return { action: `${verb} ${show(positionals[0])} to ${show(positionals[positionals.length - 1])}`, qualifiers: [] };
  }

  function databaseClient(words, program) {
    const valued = program === "mysql"
      ? ["-h", "--host", "-u", "--user", "-D", "--database", "-P", "--port", "-e", "--execute"]
      : ["-h", "--host", "-U", "--username", "-d", "--dbname", "-p", "--port", "-c", "--command", "-f", "--file"];
    const { positionals, flags } = parseArgs(words, new Set(valued));
    const database = show(flag(flags, "-d", "--dbname", "-D", "--database") || positionals[0] || "");
    const host = show(flag(flags, "-h", "--host") || "");
    const script = flag(flags, "-f", "--file");
    let action;
    if (flag(flags, "-c", "--command", "-e", "--execute")) action = "run query";
    else if (script) action = `run ${show(basename(script))}`;
    else action = "connect";
    if (database) action += action === "connect" ? ` to ${database}` : ` on ${database}`;
    return { action, qualifiers: host ? [`on ${host}`] : [] };
  }

  function tar(words) {
    const archive = words.find((w) => /\.(tar|tgz|tbz2?|txz|zip)(\.[a-z0-9]+)?$/i.test(w) || /\.tar\./i.test(w));
    const modeWord = words.find((w) => /^-?[a-zA-Z]+$/.test(w) && /[cxt]/.test(w)) || "";
    const mode = modeWord.includes("x") ? "extract" : modeWord.includes("c") ? "create" : modeWord.includes("t") ? "list" : "archive";
    return { action: `${mode} ${show(archive || "")}`.trim(), qualifiers: [] };
  }

  function find(words) {
    const { positionals, flags } = parseArgs(words, new Set(["-name", "-iname", "-type", "-mtime", "-mmin", "-size",
      "-path", "-maxdepth", "-mindepth", "-newer", "-user", "-perm"]));
    const directory = show(positionals[0] || ".");
    const pattern = show(flag(flags, "-name", "-iname", "-path") || "files");
    let action = `${pattern} in ${directory}`;
    if (hasFlag(flags, "-delete")) action += " and delete";
    else if (hasFlag(flags, "-exec", "-execdir")) action += " and exec";
    return { action, qualifiers: [] };
  }

  function search(words) {
    const { positionals, flags } = parseArgs(words, new Set(["-e", "-f", "-A", "-B", "-C", "-m", "--include",
      "--exclude", "-g", "--glob", "-t", "--type"]));
    const explicit = flag(flags, "-e");
    const pattern = show(explicit || positionals[0] || "");
    const path = show(explicit ? positionals[0] : positionals[1]);
    return { action: `search for ${pattern}${path ? ` in ${path}` : ""}`, qualifiers: [] };
  }

  function journalctl(words) {
    const { flags } = parseArgs(words, new Set(["-u", "--unit", "-n", "--lines", "--since", "--until", "-p"]));
    const unit = flag(flags, "-u", "--unit");
    return { action: unit ? `logs for ${show(unit)}` : "system logs", qualifiers: [] };
  }

  // Tools whose meaning lives in their first few subcommands.
  const SUBCOMMAND_TOOLS = {
    helm: { depth: 1, objects: 1, valued: ["-n", "--namespace", "-f", "--values", "--set", "--set-string", "--version",
      "--kube-context", "-o", "--output", "--repo", "--timeout"], qualifiers: kubernetesQualifiers },
    terraform: { depth: 1, objects: 1, valued: ["-var", "-var-file", "-target", "-chdir"] },
    tofu: { depth: 1, objects: 1, valued: ["-var", "-var-file", "-target", "-chdir"] },
    terragrunt: { depth: 1, objects: 1, valued: [] },
    gcloud: { depth: 4, objects: 0, valued: ["--project", "--region", "--zone", "--format", "--filter"] },
    az: { depth: 4, objects: 0, valued: ["-g", "--resource-group", "-n", "--name", "--subscription", "-o", "--output", "--query"] },
    gh: { depth: 2, objects: 1, valued: ["-R", "--repo", "-t", "--title", "-b", "--body", "-B", "--base", "-H", "--head"] },
    npm: { depth: 1, objects: 1, valued: [] },
    pnpm: { depth: 1, objects: 1, valued: ["--filter"] },
    yarn: { depth: 1, objects: 1, valued: [] },
    bun: { depth: 1, objects: 1, valued: [] },
    systemctl: { depth: 1, objects: 1, valued: [] },
    brew: { depth: 1, objects: 1, valued: [] },
    apt: { depth: 1, objects: 1, valued: [] },
    "apt-get": { depth: 1, objects: 1, valued: [] },
    pip: { depth: 1, objects: 1, valued: ["-r", "--requirement"] },
    pip3: { depth: 1, objects: 1, valued: ["-r", "--requirement"] },
    cargo: { depth: 1, objects: 1, valued: ["-p", "--package"] },
    go: { depth: 1, objects: 1, valued: ["-o"] },
    make: { depth: 1, objects: 0, valued: ["-C", "-f", "-j"] },
    vault: { depth: 2, objects: 1, valued: ["-address", "-namespace", "-field", "-format"] },
    argocd: { depth: 2, objects: 1, valued: ["--server", "--grpc-web-root-path"] },
    flux: { depth: 2, objects: 1, valued: ["-n", "--namespace", "--context"], qualifiers: kubernetesQualifiers },
    istioctl: { depth: 1, objects: 1, valued: ["-n", "--namespace", "--context"], qualifiers: kubernetesQualifiers },
    openssl: { depth: 1, objects: 0, valued: ["-in", "-out", "-connect", "-servername", "-days", "-newkey", "-keyout",
      "-subj", "-inform", "-outform", "-CAfile"], objectFlags: ["-in", "-connect"] },
  };

  function subcommandTool(words, config) {
    const { positionals, flags } = parseArgs(words, new Set(config.valued));
    const shown = positionals.map(show);
    const parts = shown.slice(0, config.depth + config.objects);
    for (const name of config.objectFlags || []) {
      const value = flag(flags, name);
      if (value) parts.push(show(name === "-in" ? basename(value) : value));
    }
    return { action: parts.join(" "), qualifiers: config.qualifiers ? config.qualifiers(flags) : [] };
  }

  const HANDLERS = {
    kubectl, oc: kubectl, docker, podman: docker, git, aws,
    curl, wget: curl, ssh,
    scp: (w) => copyTool(w, "copy"), rsync: (w) => copyTool(w, "sync"),
    psql: databaseClient, mysql: databaseClient,
    tar, find, grep: search, rg: search, ag: search, journalctl,
  };

  function describeSegment(words) {
    const program = basename(words[0]);
    const args = words.slice(1);
    const handler = HANDLERS[program];
    if (handler) return { program, ...handler(args, program) };
    if (SUBCOMMAND_TOOLS[program]) return { program, ...subcommandTool(args, SUBCOMMAND_TOOLS[program]) };
    return { program, action: args.slice(0, 3).map(show).join(" "), qualifiers: [] };
  }

  function truncate(text) {
    return text.length <= MAX_TITLE_LENGTH ? text : text.slice(0, MAX_TITLE_LENGTH - 1).trimEnd() + "…";
  }

  // Returns a suggested title, or an empty string when there is nothing to name.
  function suggestTitle(command) {
    if (typeof command !== "string" || !command.trim()) return "";
    const segments = splitSegments(tokenize(command.trim()))
      .map((segment) => ({ ...segment, words: stripWrappers(segment.words) }))
      .filter((segment) => segment.words.length);
    if (!segments.length) return "";

    const primary = describeSegment(segments[0].words);
    let title = primary.action ? `${primary.program}: ${primary.action}` : primary.program;
    if (primary.qualifiers.length) title += " " + primary.qualifiers.join(" ");

    let index = 1;
    const piped = [];
    while (index < segments.length && segments[index].joinedBy === "|") {
      piped.push(basename(segments[index].words[0]));
      index++;
    }
    if (piped.length) title += `, piped to ${piped.join(", ")}`;
    const remaining = segments.length - index;
    if (remaining > 0) title += ` (+${remaining} more step${remaining === 1 ? "" : "s"})`;
    return truncate(title.replace(/\s+/g, " ").trim());
  }

  return { suggestTitle, tokenize };
});
