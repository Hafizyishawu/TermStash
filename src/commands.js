// The command model, search, and persistence. Storage is injected so the same
// code runs against localStorage in the browser and a fake in tests.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else (root.TermStash = root.TermStash || {}).commands = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const STORAGE_KEY = "termstash:v1";
  const SCHEMA_VERSION = 1;

  const LIMITS = Object.freeze({
    titleLength: 200,
    commandLength: 10000,
    descriptionLength: 2000,
    tagCount: 20,
    tagLength: 40,
  });

  function newId() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  function normalizeTags(tags) {
    const list = Array.isArray(tags) ? tags : String(tags || "").split(",");
    const cleaned = list
      .map((tag) => String(tag).trim().toLowerCase().replace(/^#/, "").replace(/\s+/g, "-"))
      .filter((tag) => tag && tag.length <= LIMITS.tagLength);
    return [...new Set(cleaned)].slice(0, LIMITS.tagCount);
  }

  // Returns a list of human-readable problems; an empty list means valid.
  function validate(input) {
    const problems = [];
    const title = String(input.title || "").trim();
    const command = String(input.command || "");
    if (!title) problems.push("Title is required.");
    if (title.length > LIMITS.titleLength) problems.push(`Title must be at most ${LIMITS.titleLength} characters.`);
    if (!command.trim()) problems.push("Command is required.");
    if (command.length > LIMITS.commandLength) problems.push(`Command must be at most ${LIMITS.commandLength} characters.`);
    if (String(input.description || "").length > LIMITS.descriptionLength) {
      problems.push(`Description must be at most ${LIMITS.descriptionLength} characters.`);
    }
    return problems;
  }

  function create(input, now = Date.now()) {
    return {
      id: newId(),
      title: String(input.title).trim(),
      command: String(input.command).replace(/\s+$/, ""),
      description: String(input.description || "").trim(),
      tags: normalizeTags(input.tags),
      createdAt: now,
      updatedAt: now,
      copyCount: 0,
      lastCopiedAt: null,
    };
  }

  function update(existing, input, now = Date.now()) {
    return {
      ...existing,
      title: String(input.title).trim(),
      command: String(input.command).replace(/\s+$/, ""),
      description: String(input.description || "").trim(),
      tags: normalizeTags(input.tags),
      updatedAt: now,
    };
  }

  function recordCopy(existing, now = Date.now()) {
    return { ...existing, copyCount: (existing.copyCount || 0) + 1, lastCopiedAt: now };
  }

  // Two commands are duplicates when their text matches after collapsing
  // whitespace; titles differ between people and are not a reliable key.
  function dedupeKey(command) {
    return String(command).trim().replace(/\s+/g, " ");
  }

  // Every term must match. A term starting with # matches a tag exactly.
  // Results are ordered by how often they are copied, because the point of the
  // tool is getting to the commands you actually use.
  function search(commands, query) {
    const terms = String(query || "").toLowerCase().split(/\s+/).filter(Boolean);
    const matches = commands.filter((cmd) => {
      const haystack = [cmd.title, cmd.command, cmd.description, ...cmd.tags].join("\n").toLowerCase();
      return terms.every((term) =>
        term.startsWith("#") && term.length > 1 ? cmd.tags.includes(term.slice(1)) : haystack.includes(term),
      );
    });
    return matches.sort(
      (a, b) =>
        (b.copyCount || 0) - (a.copyCount || 0) ||
        (b.lastCopiedAt || 0) - (a.lastCopiedAt || 0) ||
        a.title.localeCompare(b.title),
    );
  }

  function emptyState() {
    return { version: SCHEMA_VERSION, commands: [], lastBackupAt: null, changedSinceBackup: false };
  }

  // Unknown or corrupt data is never silently discarded: the caller gets an
  // error and the raw value stays in storage untouched until the user decides.
  function load(storage) {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw === null) return { state: emptyState(), error: null };
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { state: null, error: "Saved data is not valid JSON." };
    }
    if (!parsed || parsed.version !== SCHEMA_VERSION || !Array.isArray(parsed.commands)) {
      return { state: null, error: `Saved data has an unsupported format (version ${parsed && parsed.version}).` };
    }
    return { state: { ...emptyState(), ...parsed }, error: null };
  }

  function save(storage, state) {
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  return {
    STORAGE_KEY,
    SCHEMA_VERSION,
    LIMITS,
    normalizeTags,
    validate,
    create,
    update,
    recordCopy,
    dedupeKey,
    search,
    emptyState,
    load,
    save,
  };
});
