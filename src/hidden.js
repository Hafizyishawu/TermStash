// Finds characters that change what a command does without changing how it
// looks: zero-width and invisible formatting characters, bidirectional
// overrides that reorder displayed text, invisible line separators, a bare
// carriage return that makes a terminal overwrite the visible line, and other
// control characters. A pack from someone else could use them to make the
// preview differ from the bytes that get copied into a terminal.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else (root.TermStash = root.TermStash || {}).hidden = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const NAMES = {
    0x061c: "Arabic letter mark",
    0x180e: "Mongolian vowel separator",
    0x200b: "Zero-width space",
    0x200c: "Zero-width non-joiner",
    0x200d: "Zero-width joiner",
    0x200e: "Left-to-right mark",
    0x200f: "Right-to-left mark",
    0x2028: "Line separator",
    0x2029: "Paragraph separator",
    0x202a: "Left-to-right embedding",
    0x202b: "Right-to-left embedding",
    0x202c: "Pop directional formatting",
    0x202d: "Left-to-right override",
    0x202e: "Right-to-left override",
    0x2060: "Word joiner",
    0x2061: "Function application",
    0x2062: "Invisible times",
    0x2063: "Invisible separator",
    0x2064: "Invisible plus",
    0x2066: "Left-to-right isolate",
    0x2067: "Right-to-left isolate",
    0x2068: "First strong isolate",
    0x2069: "Pop directional isolate",
    0xfeff: "Zero-width no-break space",
    0x0d: "Carriage return without a line feed",
  };

  // Tab and line feed are ordinary in commands, and so is CR when it is part
  // of a Windows CRLF line ending; everything else below U+0020 is flagged.
  // C1 controls matter because U+009B is an 8-bit terminal escape (CSI).
  // Spaces other than U+0020 look like word separators but a shell does not
  // split on them. Variation selectors and tag characters are invisible and
  // can carry arbitrary hidden text; the two presentation selectors are
  // allowed straight after an emoji, where they are part of how it renders.
  const PATTERN = new RegExp(
    "[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F-\\u00A0\\u00AD\\u061C\\u115F\\u1160\\u1680\\u180E" +
      "\\u2000-\\u200F\\u2028-\\u202F\\u205F-\\u206F\\u3000\\u3164\\uFE00-\\uFE0D\\uFEFF\\uFFA0\\uFFF9-\\uFFFB" +
      "\\u{E0000}-\\u{E007F}\\u{E0100}-\\u{E01EF}]|(?<!\\p{Extended_Pictographic})[\\uFE0E\\uFE0F]|\\r(?!\\n)",
    "gu",
  );

  const RANGES = [
    [0x0080, 0x009f, "C1 control character"],
    [0x00a0, 0x00a0, "No-break space"],
    [0x00ad, 0x00ad, "Soft hyphen"],
    [0x115f, 0x1160, "Hangul filler"],
    [0x3164, 0x3164, "Hangul filler"],
    [0xffa0, 0xffa0, "Hangul filler"],
    [0x1680, 0x1680, "Non-ASCII space"],
    [0x2000, 0x200a, "Non-ASCII space"],
    [0x202f, 0x202f, "Non-ASCII space"],
    [0x205f, 0x205f, "Non-ASCII space"],
    [0x3000, 0x3000, "Non-ASCII space"],
    [0x2065, 0x206f, "Invisible formatting character"],
    [0xfe00, 0xfe0f, "Variation selector"],
    [0xe0100, 0xe01ef, "Variation selector"],
    [0xfff9, 0xfffb, "Interlinear annotation character"],
    [0xe0000, 0xe007f, "Tag character"],
  ];

  function codeLabel(char) {
    return "U+" + char.codePointAt(0).toString(16).toUpperCase().padStart(4, "0");
  }

  function describe(char) {
    const point = char.codePointAt(0);
    if (NAMES[point]) return NAMES[point];
    const range = RANGES.find(([low, high]) => point >= low && point <= high);
    return range ? range[2] : "Control character";
  }

  // Returns one entry per distinct character with how often it occurs.
  function scan(text) {
    if (typeof text !== "string" || text === "") return [];
    const found = new Map();
    for (const match of text.matchAll(PATTERN)) {
      const code = codeLabel(match[0]);
      const entry = found.get(code) || { code, name: describe(match[0]), count: 0 };
      entry.count++;
      found.set(code, entry);
    }
    return [...found.values()];
  }

  // Splits text into plain runs and hidden characters so the UI can show each
  // hidden character as a visible marker instead of letting it act on layout.
  function segments(text) {
    if (typeof text !== "string") return [];
    const result = [];
    let cursor = 0;
    for (const match of text.matchAll(PATTERN)) {
      if (match.index > cursor) result.push({ type: "text", value: text.slice(cursor, match.index) });
      result.push({ type: "hidden", value: match[0], code: codeLabel(match[0]), name: describe(match[0]) });
      cursor = match.index + match[0].length;
    }
    if (cursor < text.length) result.push({ type: "text", value: text.slice(cursor) });
    return result;
  }

  return { scan, segments };
});
