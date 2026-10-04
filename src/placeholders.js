// Placeholders let a saved command describe the shape of what to run without
// storing the environment-specific or sensitive parts. The syntax is
// {{name}} or {{name:default}}. A name used more than once is filled once.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else (root.TermStash = root.TermStash || {}).placeholders = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Go and Helm template actions such as {{end}} or {{else}} share the braces,
  // so their keywords are never treated as placeholder names.
  const PLACEHOLDER_PATTERN =
    /\{\{\s*(?!(?:end|else|range|if|with|define|template|block|break|continue)\s*\}\})([A-Za-z_][A-Za-z0-9_.-]*)\s*(?::([^}]*))?\}\}/g;

  function parse(command) {
    const seen = new Map();
    for (const match of command.matchAll(PLACEHOLDER_PATTERN)) {
      const name = match[1];
      const defaultValue = match[2] === undefined ? "" : match[2].trim();
      if (!seen.has(name)) seen.set(name, { name, defaultValue });
      else if (!seen.get(name).defaultValue && defaultValue) seen.get(name).defaultValue = defaultValue;
    }
    return [...seen.values()];
  }

  function fill(command, values) {
    const defaults = new Map(parse(command).map((p) => [p.name, p.defaultValue]));
    const missing = new Set();
    const text = command.replace(PLACEHOLDER_PATTERN, (_, name) => {
      const provided = values[name];
      const value = provided !== undefined && provided !== "" ? provided : defaults.get(name);
      if (!value) missing.add(name);
      return value || "";
    });
    return { text, missing: [...missing] };
  }

  // Splits a command into literal and placeholder segments so the UI can
  // highlight placeholders using text nodes rather than generated HTML.
  function segments(command) {
    const result = [];
    let cursor = 0;
    for (const match of command.matchAll(PLACEHOLDER_PATTERN)) {
      if (match.index > cursor) result.push({ type: "text", value: command.slice(cursor, match.index) });
      result.push({ type: "placeholder", value: match[0], name: match[1] });
      cursor = match.index + match[0].length;
    }
    if (cursor < command.length) result.push({ type: "text", value: command.slice(cursor) });
    return result;
  }

  return { parse, fill, segments };
});
