// A pack is a shareable JSON file of commands. Packs cross trust boundaries:
// they are written by one person and imported by another, so export refuses
// anything that looks like a credential, and import treats the file as
// untrusted input and rebuilds every command from validated fields only.
(function (root, factory) {
  const deps =
    typeof module === "object" && module.exports
      ? { commands: require("./commands.js"), secrets: require("./secrets.js") }
      : root.CommandPad;
  const api = factory(deps.commands, deps.secrets);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.CommandPad.packs = api;
})(typeof self !== "undefined" ? self : this, function (commands, secrets) {
  "use strict";

  const FORMAT = "commandpad-pack";
  const FORMAT_VERSION = 1;
  const MAX_PACK_BYTES = 1024 * 1024;
  const MAX_PACK_COMMANDS = 1000;

  function findingsFor(cmd) {
    return secrets.scan([cmd.title, cmd.command, cmd.description].join("\n"));
  }

  // Splits commands into those safe to share and those blocked, with reasons.
  function partitionForExport(list) {
    const exportable = [];
    const blocked = [];
    for (const cmd of list) {
      const findings = findingsFor(cmd);
      if (findings.length) blocked.push({ command: cmd, findings });
      else exportable.push(cmd);
    }
    return { exportable, blocked };
  }

  // Usage counters and ids are personal and are not shared.
  function build(name, list, now = new Date()) {
    const { exportable, blocked } = partitionForExport(list);
    if (blocked.length) {
      throw new Error(`Refusing to export ${blocked.length} command(s) that look like they contain secrets.`);
    }
    return {
      format: FORMAT,
      version: FORMAT_VERSION,
      name: String(name || "CommandPad pack").trim().slice(0, commands.LIMITS.titleLength),
      exportedAt: now.toISOString(),
      commands: exportable.map((cmd) => ({
        title: cmd.title,
        command: cmd.command,
        description: cmd.description,
        tags: cmd.tags,
      })),
    };
  }

  function serialize(pack) {
    return JSON.stringify(pack, null, 2) + "\n";
  }

  // Returns { pack, errors }. A pack with any invalid command is rejected as a
  // whole rather than partially imported, so what the user previews is exactly
  // what the author wrote.
  function parse(text) {
    if (typeof text !== "string") return { pack: null, errors: ["Pack must be text."] };
    if (text.length > MAX_PACK_BYTES) return { pack: null, errors: ["Pack is larger than 1 MB."] };
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return { pack: null, errors: ["Pack is not valid JSON."] };
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) return { pack: null, errors: ["Pack must be a JSON object."] };
    if (data.format !== FORMAT) return { pack: null, errors: [`Not a CommandPad pack (format must be "${FORMAT}").`] };
    if (data.version !== FORMAT_VERSION) {
      return { pack: null, errors: [`Unsupported pack version ${data.version}; this CommandPad reads version ${FORMAT_VERSION}.`] };
    }
    if (!Array.isArray(data.commands)) return { pack: null, errors: ["Pack has no commands list."] };
    if (data.commands.length > MAX_PACK_COMMANDS) return { pack: null, errors: [`Pack has more than ${MAX_PACK_COMMANDS} commands.`] };

    const errors = [];
    const cleaned = data.commands.map((entry, index) => {
      if (!entry || typeof entry !== "object") {
        errors.push(`Command ${index + 1}: must be an object.`);
        return null;
      }
      const fields = {
        title: typeof entry.title === "string" ? entry.title : "",
        command: typeof entry.command === "string" ? entry.command : "",
        description: typeof entry.description === "string" ? entry.description : "",
        tags: Array.isArray(entry.tags) ? entry.tags.filter((t) => typeof t === "string") : [],
      };
      for (const problem of commands.validate(fields)) errors.push(`Command ${index + 1}: ${problem}`);
      return {
        title: fields.title.trim(),
        command: fields.command.replace(/\s+$/, ""),
        description: fields.description.trim(),
        tags: commands.normalizeTags(fields.tags),
      };
    });
    if (errors.length) return { pack: null, errors };

    return {
      pack: {
        name: typeof data.name === "string" ? data.name.trim().slice(0, commands.LIMITS.titleLength) : "Untitled pack",
        commands: cleaned,
      },
      errors: [],
    };
  }

  // Classifies each incoming command against what the user already has, so
  // the preview can show exactly what an import will change.
  function planImport(existing, pack) {
    const existingKeys = new Set(existing.map((cmd) => commands.dedupeKey(cmd.command)));
    const seenInPack = new Set();
    return pack.commands.map((cmd) => {
      const key = commands.dedupeKey(cmd.command);
      const duplicate = existingKeys.has(key) || seenInPack.has(key);
      seenInPack.add(key);
      return { command: cmd, duplicate, findings: findingsFor(cmd) };
    });
  }

  return {
    FORMAT,
    FORMAT_VERSION,
    MAX_PACK_BYTES,
    MAX_PACK_COMMANDS,
    partitionForExport,
    build,
    serialize,
    parse,
    planImport,
  };
});
