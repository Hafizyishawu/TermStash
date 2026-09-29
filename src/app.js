// UI wiring. All user-supplied text reaches the DOM through textContent, never
// innerHTML: packs come from other people, and a command is exactly the kind
// of string that contains angle brackets and quotes.
(function () {
  "use strict";

  const { placeholders, secrets, commands, packs, namer } = window.CommandPad;
  // Built-in suggestions. They are read-only and never written to storage, so
  // they cannot clutter saved commands, exports or backups.
  const catalog = window.CommandPad.catalog || [];
  const CATALOG_RESULT_LIMIT = 40;
  // Share of a pasted command's words a suggestion must contain to count as similar.
  const SIMILARITY_THRESHOLD = 0.6;

  const BACKUP_NUDGE_AFTER_MS = 14 * 24 * 60 * 60 * 1000;
  const BACKUP_NUDGE_MIN_COMMANDS = 5;
  const SENSITIVE_PLACEHOLDER = /pass|secret|token|key|credential|auth/i;
  const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  const CLIPBOARD_TIMEOUT_MS = 1500;
  // Enter confirms a dialog and also copies the selected row. Without this
  // window, a held or bouncing Enter closes one dialog and opens the next.
  const KEY_GUARD_AFTER_DIALOG_MS = 350;
  let lastDialogClosedAt = -Infinity;

  const $ = (id) => document.getElementById(id);

  let state = commands.emptyState();
  let storage = null;
  let storageProblem = null;
  let rawUnreadableData = null;
  let editingId = null;
  // Rows are items of three kinds: "saved" commands, "catalog" suggestions,
  // and a "draft" row offering to save pasted text. Keys are "<kind>:<id>".
  let selectedKey = null;
  let lastSuggestedTitle = "";
  let fillTarget = null;
  let pendingImport = null;
  let backupNudgeDismissed = false;
  // The search box is single-line, so a pasted multi-line command is shown
  // flattened. The original is kept so "Save as new command" stores it intact.
  let pastedText = null;
  // Placeholder values are remembered per command for this tab only. They are
  // frequently hostnames or tokens, so they are never written to storage.
  const sessionValues = new Map();
  const toolNameCache = new Map();

  function h(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value === undefined || value === null || value === false) continue;
      if (key === "text") node.textContent = value;
      else if (key === "className") node.className = value;
      else if (key.startsWith("on")) node.addEventListener(key.slice(2).toLowerCase(), value);
      else node.setAttribute(key, value === true ? "" : value);
    }
    for (const child of children.flat()) {
      if (child === null || child === undefined || child === false) continue;
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return node;
  }

  function plural(count, word) {
    return `${count} ${word}${count === 1 ? "" : "s"}`;
  }

  function initStorage() {
    try {
      storage = window.localStorage;
      const { state: loaded, error } = commands.load(storage);
      if (error) {
        storageProblem = `${error} Nothing has been changed, and saving is paused so the data is not overwritten.`;
        rawUnreadableData = storage.getItem(commands.STORAGE_KEY);
      } else {
        state = loaded;
      }
    } catch {
      storage = null;
      storageProblem = "This browser is blocking local storage, so changes will not be saved after you close the tab.";
    }
  }

  function persist() {
    if (!storage || rawUnreadableData !== null) return;
    try {
      commands.save(storage, state);
    } catch {
      storageProblem = "Saving failed, probably because browser storage is full. Export a pack now so nothing is lost.";
      renderBanner();
    }
  }

  function markChanged() {
    state.changedSinceBackup = true;
    persist();
    render();
  }

  function findCommand(id) {
    return state.commands.find((cmd) => cmd.id === id);
  }

  function replaceCommand(updated) {
    state.commands = state.commands.map((cmd) => (cmd.id === updated.id ? updated : cmd));
  }

  function visibleCommands() {
    return commands.search(state.commands, $("search").value);
  }

  function toolName(command) {
    if (!toolNameCache.has(command)) {
      const suggestion = namer.suggestTitle(command);
      toolNameCache.set(command, suggestion.split(":")[0].split(" ")[0] || "sh");
    }
    return toolNameCache.get(command);
  }

  // Stable hue per tool so the same CLI is always the same colour.
  function toolHue(name) {
    let hash = 0;
    for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    return hash % 360;
  }

  function itemKey(item) {
    return `${item.kind}:${item.cmd.id}`;
  }

  // Catalog matches exclude anything already saved, ranked by how many search
  // words appear in the title. Suggestions only show on an empty notepad or
  // when searching, so they never crowd the user's own list.
  function catalogSuggestions(query) {
    if (!catalog.length) return { items: [], total: 0 };
    if (!query.trim()) {
      const starters = state.commands.length === 0 ? catalog.filter((entry) => entry.starter) : [];
      return { items: starters.map((cmd) => ({ kind: "catalog", cmd })), total: starters.length };
    }
    const saved = new Set(state.commands.map((cmd) => commands.dedupeKey(cmd.command)));
    const terms = query.toLowerCase().split(/\s+/).filter((term) => term && !term.startsWith("#"));
    const ranked = pastedText !== null
      ? similarCatalogEntries(terms)
      : commands.search(catalog, query)
        .map((entry) => ({ entry, score: terms.filter((term) => entry.title.toLowerCase().includes(term)).length }))
        .sort((a, b) => b.score - a.score)
        .map(({ entry }) => entry);
    const matches = ranked.filter((entry) => !saved.has(commands.dedupeKey(entry.command)));
    return {
      items: matches.slice(0, CATALOG_RESULT_LIMIT).map((cmd) => ({ kind: "catalog", cmd })),
      total: matches.length,
    };
  }

  // A pasted command rarely matches word-for-word: its values (a pod name, a
  // namespace) are specific to the person pasting. Similarity is judged only
  // on words the catalog itself uses, since unknown words are almost always
  // values, and the program name must match.
  let catalogVocabulary = null;
  function normaliseTerm(term) {
    return term.startsWith("-") ? term.split("=")[0] : term;
  }

  function vocabulary() {
    if (!catalogVocabulary) {
      catalogVocabulary = new Set();
      for (const entry of catalog) {
        for (const token of entry.command.toLowerCase().split(/\s+/)) if (token) catalogVocabulary.add(normaliseTerm(token));
      }
    }
    return catalogVocabulary;
  }

  function similarCatalogEntries(queryTerms) {
    const known = vocabulary();
    const program = normaliseTerm(queryTerms[0] || "");
    const terms = [...new Set(queryTerms.map(normaliseTerm))].filter((term) => known.has(term));
    if (!known.has(program) || terms.length < 2) return [];
    return catalog
      .map((entry) => {
        // Multi-line scripts contain almost every word; compare on their title
        // and first command line so they do not outrank the one-line match.
        const firstLine = entry.command.split("\n").find((line) => line.trim() && !line.trim().startsWith("#")) || "";
        const haystack = [entry.title, firstLine, entry.description, ...entry.tags].join("\n").toLowerCase();
        const overlap = haystack.includes(program) ? terms.filter((term) => haystack.includes(term)).length / terms.length : 0;
        return { entry, overlap };
      })
      .filter(({ overlap }) => overlap >= SIMILARITY_THRESHOLD)
      // Ties go to shorter commands, the closest to a single pasted line.
      .sort((a, b) => b.overlap - a.overlap || a.entry.command.length - b.entry.command.length)
      .map(({ entry }) => entry);
  }

  // A pasted command that is not already saved gets a row offering to save
  // it, placed first so paste-then-Enter keeps meaning "save this".
  function draftItem(savedMatches) {
    if (pastedText === null) return null;
    const key = commands.dedupeKey(pastedText);
    if (savedMatches.some((item) => commands.dedupeKey(item.cmd.command) === key)) return null;
    return { kind: "draft", cmd: { id: "pasted", title: "Save as new command", command: pastedText, tags: [] } };
  }

  function visibleItems() {
    const query = $("search").value;
    const saved = commands.search(state.commands, query).map((cmd) => ({ kind: "saved", cmd }));
    const suggestions = catalogSuggestions(query);
    const draft = draftItem(saved);
    return { saved, draft, suggestions: suggestions.items, suggestionTotal: suggestions.total };
  }

  function orderedItems({ saved, draft, suggestions }) {
    return [...(draft ? [draft] : []), ...saved, ...suggestions];
  }

  function selectedItem() {
    return orderedItems(visibleItems()).find((item) => itemKey(item) === selectedKey) || null;
  }

  function render() {
    renderBanner();
    const visible = visibleItems();
    const items = orderedItems(visible);
    if (!items.some((item) => itemKey(item) === selectedKey)) selectedKey = items[0] ? itemKey(items[0]) : null;

    const total = state.commands.length;
    const query = $("search").value.trim();
    const rows = [];
    if (visible.draft) rows.push(renderRow(visible.draft));
    rows.push(...visible.saved.map(renderRow));
    if (visible.suggestions.length) {
      const heading = query ? "Suggestions" : "Start with a suggestion";
      const detail = query && visible.suggestionTotal > visible.suggestions.length
        ? `Top ${visible.suggestions.length} of ${visible.suggestionTotal}`
        : "Built-in, not saved until you save them";
      rows.push(h("li", { className: "group-label", role: "presentation" }, h("span", { text: heading }), h("span", { className: "group-detail", text: detail })));
      rows.push(...visible.suggestions.map(renderRow));
    }
    $("command-list").replaceChildren(...rows);

    $("empty-state").hidden = total !== 0 || query !== "";
    $("command-list").hidden = items.length === 0;
    $("no-results").hidden = !(query && items.length === 0);
    $("no-results-query").textContent = query;
    $("catalog-count").textContent = catalog.length.toLocaleString();
    $("catalog-hint").hidden = catalog.length === 0;
    const savedPart = total === 0 ? "" : query ? `${visible.saved.length} of ${plural(total, "saved command")}` : plural(total, "saved command");
    const suggestionPart = query && visible.suggestionTotal ? plural(visible.suggestionTotal, "suggestion") : "";
    $("result-count").textContent = [savedPart, suggestionPart].filter(Boolean).join(" · ");
  }

  function renderCommandText(command) {
    return placeholders.segments(command).map((segment) =>
      segment.type === "placeholder" ? h("span", { className: "ph", text: segment.value }) : segment.value,
    );
  }

  function renderRow(item) {
    const { kind, cmd } = item;
    const key = itemKey(item);
    const selected = key === selectedKey;
    const hasPlaceholders = placeholders.parse(cmd.command).length > 0;
    const isQuery = kind === "catalog" && cmd.language && cmd.language !== "bash";
    const tool = kind === "catalog" ? cmd.tool : kind === "draft" ? "+" : toolName(cmd.command);
    const badge = h("span", { className: "tool", "aria-hidden": "true", text: kind === "draft" ? "+" : tool.slice(0, 2) });
    if (kind !== "draft") badge.style.setProperty("--hue", String(toolHue(tool)));

    const copyLabel = kind === "draft" ? "Save" : hasPlaceholders ? "Fill & copy" : "Copy";
    const primaryAction = kind === "draft" ? saveSearchAsCommand : () => startCopy(item);
    let secondary = [];
    if (kind === "saved") {
      secondary = [
        h("button", { type: "button", className: "btn btn-small btn-ghost", text: "Edit", onClick: () => openEditor(cmd.id) }),
        h("button", { type: "button", className: "btn btn-small btn-ghost is-danger", text: "Delete", onClick: () => confirmDelete(cmd.id) }),
      ];
    } else if (kind === "catalog") {
      secondary = [
        h("button", { type: "button", className: "btn btn-small btn-ghost", text: "Customize", title: "Open in the editor before saving", onClick: () => customizeSuggestion(item) }),
        h("button", { type: "button", className: "btn btn-small btn-ghost", text: "Save", title: "Add to your commands as-is", onClick: () => saveSuggestion(item) }),
      ];
    }

    const meta = [];
    if (kind === "saved" && secrets.scan(cmd.command).length) {
      meta.push(h("span", { className: "badge-warn", text: "Possible secret", title: "Blocked from export. Replace the value with a {{placeholder}}." }));
    }
    if (kind === "saved" && cmd.copyCount) meta.push(h("span", { title: `Copied ${plural(cmd.copyCount, "time")}`, text: `${cmd.copyCount}×` }));

    return h("li", {
      className: `row is-${kind}`,
      "data-key": key,
      "aria-current": selected ? "true" : "false",
      onClick: (event) => {
        if (event.target.closest("button")) return;
        if (!selected) select(key);
      },
    },
      badge,
      h("div", { className: "row-main" },
        h("div", { className: "row-top" },
          h("h3", { className: "row-title", text: cmd.title }),
          cmd.tags.length ? h("div", { className: "row-tags" }, cmd.tags.slice(0, 3).map((tag) =>
            h("button", { type: "button", className: "row-tag", text: tag, title: `Filter by #${tag}`, onClick: () => setSearch(`#${tag}`) }),
          )) : null,
        ),
        h("pre", {
          className: `row-command mono${isQuery ? " is-query" : ""}`,
          title: selected ? "Click to copy" : null,
          onClick: selected && kind !== "draft" ? () => startCopy(item) : null,
        }, renderCommandText(cmd.command)),
        selected && cmd.description ? h("p", { className: "row-note", text: cmd.description }) : null,
      ),
      h("div", { className: "row-side" },
        h("div", { className: "row-meta" }, meta),
        h("div", { className: "row-actions" },
          secondary,
          h("button", { type: "button", className: "btn btn-small btn-primary", onClick: primaryAction },
            copyLabel,
            selected ? h("kbd", { className: "kbd kbd-on-accent", text: "↵" }) : null,
          ),
        ),
      ),
    );
  }

  function select(key) {
    selectedKey = key;
    render();
    document.querySelector('.row[aria-current="true"]')?.scrollIntoView({ block: "nearest" });
  }

  function moveSelection(delta) {
    const items = orderedItems(visibleItems());
    if (!items.length) return;
    const index = items.findIndex((item) => itemKey(item) === selectedKey);
    const next = Math.min(items.length - 1, Math.max(0, index + delta));
    select(itemKey(items[next]));
  }

  function saveSuggestion(item) {
    const created = commands.create({
      title: item.cmd.title,
      command: item.cmd.command,
      description: item.cmd.description,
      tags: item.cmd.tags,
    });
    state.commands.push(created);
    selectedKey = `saved:${created.id}`;
    markChanged();
    toast(`Saved “${created.title}” to your commands`);
  }

  function customizeSuggestion(item) {
    openEditor(null, {
      title: item.cmd.title,
      command: item.cmd.command,
      description: item.cmd.description,
      tags: item.cmd.tags,
    });
  }

  function renderBanner() {
    const banner = $("banner");
    if (storageProblem) {
      banner.className = "banner is-error";
      banner.replaceChildren(
        h("span", { text: storageProblem }),
        rawUnreadableData !== null
          ? h("button", { type: "button", className: "btn btn-quiet btn-small", text: "Download the unreadable data", onClick: downloadRawData })
          : null,
      );
      banner.hidden = false;
      return;
    }
    const overdue = state.lastBackupAt === null || Date.now() - state.lastBackupAt > BACKUP_NUDGE_AFTER_MS;
    if (!backupNudgeDismissed && state.changedSinceBackup && overdue && state.commands.length >= BACKUP_NUDGE_MIN_COMMANDS) {
      banner.className = "banner";
      banner.replaceChildren(
        h("span", { text: "Your commands live only in this browser. Export a backup so clearing site data cannot lose them." }),
        h("button", { type: "button", className: "btn btn-small btn-ghost", text: "Later", onClick: () => { backupNudgeDismissed = true; renderBanner(); } }),
        h("button", { type: "button", className: "btn btn-small btn-primary", text: "Export backup", onClick: openExport }),
      );
      banner.hidden = false;
      return;
    }
    banner.hidden = true;
  }

  function setSearch(value) {
    $("search").value = value;
    render();
  }

  let toastTimer = null;
  function toast(message) {
    const node = $("toast");
    node.hidden = true;
    node.textContent = message;
    void node.offsetWidth;
    node.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { node.hidden = true; }, 2200);
  }

  // The async Clipboard API can stay pending while the browser waits on a
  // permission decision, so it is raced against a timeout before falling back.
  async function writeClipboard(text) {
    try {
      await Promise.race([
        navigator.clipboard.writeText(text),
        new Promise((_, reject) => setTimeout(() => reject(new Error("clipboard timeout")), CLIPBOARD_TIMEOUT_MS)),
      ]);
      return true;
    } catch {
      // file:// pages and some embedded contexts lack the async Clipboard API.
      const area = h("textarea", { className: "offscreen", readonly: true });
      area.value = text;
      document.body.append(area);
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      return ok;
    }
  }

  // Only saved commands track usage; suggestions are read-only and unsaved.
  async function copyText(item, text) {
    if (!(await writeClipboard(text))) {
      toast("Copy failed. Select the command and copy it manually.");
      return;
    }
    if (item.kind === "saved") {
      const current = findCommand(item.cmd.id);
      if (current) replaceCommand(commands.recordCopy(current));
      persist();
    }
    render();
    toast(`Copied “${item.cmd.title}”`);
  }

  function startCopy(item) {
    if (!item || item.kind === "draft") return;
    const fields = placeholders.parse(item.cmd.command);
    if (!fields.length) {
      copyText(item, item.cmd.command);
      return;
    }
    openFill(item, fields);
  }

  function openFill(item, fields) {
    fillTarget = item;
    const remembered = sessionValues.get(itemKey(item)) || {};
    $("fill-heading").textContent = item.cmd.title;
    const container = $("fill-fields");
    container.replaceChildren(...fields.map((field) => {
      const inputId = `fill-${field.name}`;
      const input = h("input", {
        id: inputId,
        "data-name": field.name,
        type: SENSITIVE_PLACEHOLDER.test(field.name) ? "password" : "text",
        placeholder: field.defaultValue || field.name,
        autocomplete: "off",
        spellcheck: "false",
        className: "input",
        onInput: updateFillPreview,
      });
      input.value = remembered[field.name] || "";
      return h("div", { className: "fill-field" }, h("label", { for: inputId, text: field.name }), input);
    }));
    updateFillPreview();
    $("fill-dialog").showModal();
    container.querySelector("input")?.focus();
  }

  function fillValues() {
    const values = {};
    for (const input of $("fill-fields").querySelectorAll("input")) values[input.dataset.name] = input.value;
    return values;
  }

  // The preview highlights filled values and unfilled placeholders, and masks
  // sensitive values to match their password inputs.
  function updateFillPreview() {
    if (!fillTarget) return;
    const { command } = fillTarget.cmd;
    const values = fillValues();
    const defaults = new Map(placeholders.parse(command).map((p) => [p.name, p.defaultValue]));
    let missing = 0;
    const parts = placeholders.segments(command).map((segment) => {
      if (segment.type === "text") return segment.value;
      const value = values[segment.name] || defaults.get(segment.name);
      if (!value) {
        missing++;
        return h("span", { className: "ph", text: segment.value });
      }
      const shown = SENSITIVE_PLACEHOLDER.test(segment.name) && values[segment.name] ? "•".repeat(8) : value;
      return h("span", { className: "ph", text: shown });
    });
    $("fill-preview").replaceChildren(...parts);
    $("fill-submit").textContent = missing ? `Copy with ${missing} empty` : "Copy";
  }

  function submitFill(event) {
    event.preventDefault();
    if (!fillTarget) return;
    const item = fillTarget;
    const values = fillValues();
    sessionValues.set(itemKey(item), values);
    $("fill-dialog").close();
    copyText(item, placeholders.fill(item.cmd.command, values).text);
  }

  // `draft` pre-fills a new command: a string is the command alone, an object
  // may also carry title, description and tags (from a suggestion).
  function openEditor(id, draft) {
    editingId = id || null;
    const cmd = id ? findCommand(id) : null;
    const template = typeof draft === "string" ? { command: draft } : draft || {};
    const source = cmd || template;
    $("editor-heading").textContent = cmd ? "Edit command" : "New command";
    $("field-command").value = source.command || "";
    $("field-title").value = source.title || "";
    $("field-description").value = source.description || "";
    $("field-tags").value = (source.tags || []).join(", ");
    $("editor-errors").hidden = true;
    // A title keeps following the command only if nobody chose it: an
    // existing title that still equals what the namer would say, or none.
    lastSuggestedTitle = source.title ? (source.title === namer.suggestTitle(source.command || "") ? source.title : null) : "";
    onCommandInput();
    $("editor-dialog").showModal();
    (cmd || !source.command ? $("field-command") : $("field-title")).focus();
  }

  function onCommandInput() {
    const command = $("field-command").value;
    const title = $("field-title");
    if (lastSuggestedTitle !== null && (title.value === "" || title.value === lastSuggestedTitle)) {
      lastSuggestedTitle = namer.suggestTitle(command);
      title.value = lastSuggestedTitle;
    }
    $("title-hint").hidden = !(lastSuggestedTitle && title.value === lastSuggestedTitle);
    renderSecretWarning($("editor-secret-warning"), secrets.scan(command));
  }

  function onTitleInput() {
    $("title-hint").hidden = !(lastSuggestedTitle && $("field-title").value === lastSuggestedTitle);
    if ($("field-title").value === "") lastSuggestedTitle = "";
  }

  function renderSecretWarning(node, findings) {
    if (!findings.length) {
      node.hidden = true;
      return;
    }
    node.replaceChildren(
      h("strong", { text: `Looks like a secret: ${findings.map((f) => f.label).join(", ")}.` }),
      " Swap the value for ",
      h("span", { className: "mono", text: "{{token}}" }),
      " or ",
      h("span", { className: "mono", text: "$TOKEN" }),
      ". Commands with secrets are stored unencrypted and cannot be exported.",
    );
    node.hidden = false;
  }

  async function submitEditor(event) {
    event.preventDefault();
    const input = {
      title: $("field-title").value,
      command: $("field-command").value,
      description: $("field-description").value,
      tags: $("field-tags").value,
    };
    const problems = commands.validate(input);
    if (problems.length) {
      $("editor-errors").textContent = problems.join(" ");
      $("editor-errors").hidden = false;
      return;
    }
    const findings = secrets.scan(input.command);
    if (findings.length) {
      const proceed = await confirmAction({
        heading: "Save a command that looks like it has a secret?",
        message: `Found: ${findings.map((f) => f.label).join(", ")}. It will be stored unencrypted in this browser and cannot be exported. A {{placeholder}} keeps the command reusable without storing the value.`,
        accept: "Save anyway",
        cancel: "Go back",
      });
      if (!proceed) {
        $("editor-dialog").showModal();
        $("field-command").focus();
        return;
      }
    }
    let savedId = editingId;
    if (editingId) replaceCommand(commands.update(findCommand(editingId), input));
    else {
      const created = commands.create(input);
      state.commands.push(created);
      savedId = created.id;
    }
    if ($("editor-dialog").open) $("editor-dialog").close();
    selectedKey = `saved:${savedId}`;
    pastedText = null;
    markChanged();
    toast(editingId ? "Saved" : "Added to your notepad");
  }

  function confirmAction({ heading, message, accept, cancel = "Cancel", danger = false }) {
    return new Promise((resolve) => {
      const dialog = $("confirm-dialog");
      const editor = $("editor-dialog");
      if (editor.open) editor.close();
      $("confirm-heading").textContent = heading;
      $("confirm-message").textContent = message;
      $("confirm-accept").textContent = accept;
      $("confirm-accept").className = danger ? "btn btn-danger" : "btn btn-primary";
      $("confirm-cancel").textContent = cancel;
      const form = $("confirm-form");
      const onSubmit = (event) => {
        event.preventDefault();
        cleanup(true);
      };
      const onClose = () => cleanup(false);
      function cleanup(result) {
        form.removeEventListener("submit", onSubmit);
        dialog.removeEventListener("close", onClose);
        if (dialog.open) dialog.close();
        resolve(result);
      }
      form.addEventListener("submit", onSubmit);
      dialog.addEventListener("close", onClose);
      dialog.showModal();
      $("confirm-cancel").focus();
    });
  }

  async function confirmDelete(id) {
    const cmd = findCommand(id);
    if (!cmd) return;
    const proceed = await confirmAction({
      heading: "Delete this command?",
      message: `“${cmd.title}” will be removed from this browser. It can only be recovered from an exported pack.`,
      accept: "Delete",
      danger: true,
    });
    if (!proceed) return;
    state.commands = state.commands.filter((c) => c.id !== id);
    sessionValues.delete(id);
    markChanged();
    toast("Deleted");
  }

  function exportSelection() {
    const scope = document.querySelector("input[name=export-scope]:checked").value;
    return scope === "shown" ? visibleCommands() : state.commands;
  }

  function updateExportDialog() {
    const { exportable, blocked } = packs.partitionForExport(exportSelection());
    $("export-scope-all").textContent = `All commands (${state.commands.length})`;
    $("export-scope-shown").textContent = `Commands matching the current search (${visibleCommands().length})`;
    const node = $("export-blocked");
    if (blocked.length) {
      node.replaceChildren(
        h("strong", { text: `${plural(blocked.length, "command")} left out because they look like they contain secrets:` }),
        h("ul", {}, blocked.map(({ command, findings }) =>
          h("li", {}, command.title, h("span", { className: "muted", text: ` · ${findings.map((f) => f.label).join(", ")}` })),
        )),
        "Swap the values for {{placeholders}} to include them.",
      );
      node.hidden = false;
    } else node.hidden = true;
    $("export-submit").textContent = `Download ${plural(exportable.length, "command")}`;
    $("export-submit").disabled = exportable.length === 0;
  }

  function openExport() {
    if (!state.commands.length) {
      toast("Nothing to export yet");
      return;
    }
    if (!$("export-name").value) $("export-name").value = "My commands";
    updateExportDialog();
    $("export-dialog").showModal();
  }

  function download(filename, text) {
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const link = h("a", { href: url, download: filename });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function slug(text) {
    return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "commands";
  }

  function submitExport(event) {
    event.preventDefault();
    const selection = exportSelection();
    const { exportable, blocked } = packs.partitionForExport(selection);
    const name = $("export-name").value.trim() || "My commands";
    download(`${slug(name)}.commandpad.json`, packs.serialize(packs.build(name, exportable)));
    // Only an export of everything that can be exported counts as a backup.
    if (exportable.length + blocked.length === state.commands.length) {
      state.lastBackupAt = Date.now();
      state.changedSinceBackup = false;
      persist();
    }
    $("export-dialog").close();
    render();
    toast(`Exported ${plural(exportable.length, "command")}`);
  }

  async function onImportFile(event) {
    const file = event.target.files[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > packs.MAX_PACK_BYTES) {
      showImportErrors(file.name, ["Pack is larger than 1 MB."]);
      return;
    }
    const { pack, errors } = packs.parse(await file.text());
    if (errors.length) {
      showImportErrors(file.name, errors);
      return;
    }
    pendingImport = packs.planImport(state.commands, pack);
    $("import-heading").textContent = `Import “${pack.name}”`;
    $("import-errors").hidden = true;
    const duplicates = pendingImport.filter((p) => p.duplicate).length;
    $("import-summary").textContent =
      `${plural(pendingImport.length, "command")}` +
      (duplicates ? `, ${duplicates} already in your notepad` : "") +
      ". Read each one before importing. A pack runs nothing, but you will.";
    $("import-list").replaceChildren(...pendingImport.map((item, index) => {
      const checkbox = h("input", {
        type: "checkbox",
        id: `import-${index}`,
        "data-index": String(index),
        checked: !item.duplicate && !item.findings.length,
        disabled: item.duplicate,
        onChange: updateImportButton,
      });
      return h("li", { className: item.duplicate ? "import-item is-duplicate" : "import-item" },
        checkbox,
        h("label", { for: `import-${index}` },
          h("span", { className: "import-title-line" },
            item.command.title,
            item.duplicate ? h("span", { className: "badge-neutral", text: "Already saved" }) : null,
            item.findings.length ? h("span", { className: "badge-warn", text: `Possible secret: ${item.findings.map((f) => f.label).join(", ")}` }) : null,
          ),
          h("pre", { className: "import-command mono" }, renderCommandText(item.command.command)),
        ),
      );
    }));
    $("import-list").hidden = false;
    updateImportButton();
    $("import-dialog").showModal();
  }

  function showImportErrors(filename, errors) {
    pendingImport = null;
    $("import-heading").textContent = `Could not import ${filename}`;
    $("import-summary").textContent = "Nothing was imported.";
    $("import-errors").replaceChildren(h("ul", {}, errors.slice(0, 20).map((e) => h("li", { text: e }))));
    $("import-errors").hidden = false;
    $("import-list").replaceChildren();
    $("import-list").hidden = true;
    $("import-submit").hidden = true;
    $("import-dialog").showModal();
  }

  function selectedImports() {
    return [...$("import-list").querySelectorAll("input[type=checkbox]:checked")].map((box) => pendingImport[Number(box.dataset.index)]);
  }

  function updateImportButton() {
    const count = pendingImport ? selectedImports().length : 0;
    const button = $("import-submit");
    button.hidden = false;
    button.textContent = `Import ${plural(count, "command")}`;
    button.disabled = count === 0;
  }

  function submitImport(event) {
    event.preventDefault();
    if (!pendingImport) return;
    const chosen = selectedImports();
    for (const { command } of chosen) state.commands.push(commands.create(command));
    pendingImport = null;
    $("import-dialog").close();
    markChanged();
    toast(`Imported ${plural(chosen.length, "command")}`);
  }

  function downloadRawData() {
    download("commandpad-unreadable-data.json", rawUnreadableData || "");
  }

  function isTyping(target) {
    return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
  }

  // A focused button or link owns Enter and Space; hijacking them would make
  // "Delete" copy instead when reached with Tab.
  function isInteractive(target) {
    return target instanceof HTMLElement && target.closest("button, a[href], summary") !== null;
  }

  function anyDialogOpen() {
    return [...document.querySelectorAll("dialog")].some((d) => d.open);
  }

  function hasModifier(event) {
    return IS_MAC ? event.metaKey : event.ctrlKey;
  }

  // Selection keys work both from the search box and from anywhere on the
  // page, so the keyboard path never requires reaching for the mouse.
  function handleSelectionKey(event) {
    if (event.isComposing) return false;
    if (event.key === "Enter" && (event.repeat || performance.now() - lastDialogClosedAt < KEY_GUARD_AFTER_DIALOG_MS)) {
      event.preventDefault();
      return true;
    }
    const item = selectedItem();
    if (event.key === "ArrowDown") moveSelection(1);
    else if (event.key === "ArrowUp") moveSelection(-1);
    else if (event.key === "Enter" && hasModifier(event)) editItem(item);
    else if (event.key === "Enter") {
      if (item?.kind === "draft") saveSearchAsCommand();
      else if (item) startCopy(item);
      else if ($("search").value.trim()) saveSearchAsCommand();
    }
    else if (event.key.toLowerCase() === "e" && hasModifier(event)) editItem(item);
    else if (event.key.toLowerCase() === "s" && hasModifier(event)) {
      if (item?.kind === "catalog") saveSuggestion(item);
      else if (item?.kind === "draft") saveSearchAsCommand();
    }
    // Cmd+Backspace inside the search box is the platform's delete-line
    // shortcut, so deletion by keyboard is only bound outside it.
    else if (event.key === "Backspace" && hasModifier(event) && event.target !== $("search")) {
      if (item?.kind === "saved") confirmDelete(item.cmd.id);
    }
    else return false;
    event.preventDefault();
    return true;
  }

  // Editing a suggestion opens it as a new command; nothing is saved until
  // the editor's Save.
  function editItem(item) {
    if (!item) return;
    if (item.kind === "saved") openEditor(item.cmd.id);
    else if (item.kind === "catalog") customizeSuggestion(item);
    else saveSearchAsCommand();
  }

  function onGlobalKey(event) {
    if (anyDialogOpen()) return;
    if (event.target === $("search")) return;
    if (isTyping(event.target) || isInteractive(event.target)) return;
    if (handleSelectionKey(event)) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === "/") {
      event.preventDefault();
      $("search").focus();
      $("search").select();
    } else if (event.key.toLowerCase() === "n") {
      event.preventDefault();
      openEditor(null);
    } else if (event.key.toLowerCase() === "e" && selectedItem()) {
      event.preventDefault();
      editItem(selectedItem());
    }
  }

  function onSearchKey(event) {
    if (handleSelectionKey(event)) return;
    if (event.key === "Escape") {
      if ($("search").value) setSearch("");
      else $("search").blur();
    }
  }

  function onEditorKey(event) {
    if (event.key === "Enter" && hasModifier(event)) {
      event.preventDefault();
      $("editor-form").requestSubmit();
    }
  }

  function flattenForSearch(text) {
    return text.replace(/\\?\r?\n/g, " ").replace(/\s+/g, " ").trim();
  }

  // Pasting searches, whether into the search box or anywhere else on the
  // page, because the usual reason to paste is "do I already have this?".
  // When nothing matches, the no-results state offers to save it.
  function onGlobalPaste(event) {
    const search = $("search");
    if (anyDialogOpen() || (isTyping(event.target) && event.target !== search)) return;
    const text = event.clipboardData?.getData("text/plain");
    if (!text || !text.trim()) return;
    event.preventDefault();
    const original = text.trim();
    const flattened = flattenForSearch(original);
    if (event.target === search) search.setRangeText(flattened, search.selectionStart, search.selectionEnd, "end");
    else search.value = flattened;
    pastedText = search.value === flattened ? original : null;
    search.focus();
    render();
  }

  function onSearchInput() {
    if (pastedText !== null && $("search").value !== flattenForSearch(pastedText)) pastedText = null;
    render();
  }

  function saveSearchAsCommand() {
    openEditor(null, pastedText ?? $("search").value.trim());
  }

  function onStorageEvent(event) {
    if (event.key !== commands.STORAGE_KEY || rawUnreadableData !== null) return;
    const { state: loaded, error } = commands.load(storage);
    if (!error) {
      state = loaded;
      render();
    }
  }

  function wireDialogs() {
    for (const button of document.querySelectorAll("[data-close]")) {
      button.addEventListener("click", () => button.closest("dialog").close());
    }
    // Clicking the backdrop closes a dialog, as people expect from a modal.
    for (const dialog of document.querySelectorAll("dialog")) {
      dialog.addEventListener("close", () => { lastDialogClosedAt = performance.now(); });
      dialog.addEventListener("click", (event) => {
        if (event.target === dialog) dialog.close();
      });
    }
  }

  function localiseShortcuts() {
    if (IS_MAC) return;
    for (const node of document.querySelectorAll("[data-mod]")) node.textContent = "Ctrl";
  }

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator) || !/^https?:$/.test(location.protocol)) return;
    navigator.serviceWorker.register("sw.js").catch(() => {
      // Offline support is an enhancement; the app works without it.
    });
  }

  function init() {
    initStorage();
    wireDialogs();
    localiseShortcuts();
    $("search").addEventListener("input", onSearchInput);
    $("search").addEventListener("keydown", onSearchKey);
    $("new-command").addEventListener("click", () => openEditor(null));
    $("no-results-new").addEventListener("click", saveSearchAsCommand);
    $("export-pack").addEventListener("click", openExport);
    $("import-pack").addEventListener("click", () => $("import-file").click());
    $("import-file").addEventListener("change", onImportFile);
    $("field-command").addEventListener("input", onCommandInput);
    $("field-title").addEventListener("input", onTitleInput);
    $("editor-form").addEventListener("submit", submitEditor);
    $("editor-form").addEventListener("keydown", onEditorKey);
    $("fill-form").addEventListener("submit", submitFill);
    $("export-form").addEventListener("submit", submitExport);
    $("export-form").addEventListener("change", updateExportDialog);
    $("import-form").addEventListener("submit", submitImport);
    document.addEventListener("keydown", onGlobalKey);
    document.addEventListener("paste", onGlobalPaste);
    window.addEventListener("storage", onStorageEvent);
    render();
    registerServiceWorker();
    $("search").focus();
  }

  init();
})();
