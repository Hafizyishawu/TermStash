#!/usr/bin/env node
// Serves dist/ the way Cloudflare Pages does for this site, so browser tests
// run against the real security headers: rules from _headers (the /* rule and
// exact paths, with "! Name" removing an inherited header), index.html at /,
// and 404.html with a 404 status for anything that does not exist.
"use strict";

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "dist");
const PORT = Number(process.env.PORT || 4173);
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
  ".txt": "text/plain; charset=utf-8",
};

function parseHeaderRules() {
  const rules = [];
  for (const line of fs.readFileSync(path.join(ROOT, "_headers"), "utf8").split("\n")) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    if (!/^\s/.test(line)) rules.push({ pattern: line.trim(), lines: [] });
    else rules.at(-1).lines.push(line.trim());
  }
  return rules;
}

const RULES = parseHeaderRules();

function headersFor(urlPath) {
  const headers = new Map();
  for (const { pattern, lines } of RULES) {
    if (pattern !== "/*" && pattern !== urlPath) continue;
    for (const line of lines) {
      if (line.startsWith("!")) {
        headers.delete(line.slice(1).trim().toLowerCase());
        continue;
      }
      const separator = line.indexOf(":");
      const name = line.slice(0, separator).trim();
      const value = line.slice(separator + 1).trim();
      const existing = headers.get(name.toLowerCase());
      headers.set(name.toLowerCase(), [name, existing ? `${existing[1]}, ${value}` : value]);
    }
  }
  return headers;
}

function resolveFile(urlPath) {
  const relative = urlPath === "/" ? "index.html" : decodeURIComponent(urlPath).replace(/^\/+/, "");
  const file = path.resolve(ROOT, relative);
  if (!file.startsWith(ROOT + path.sep) || path.basename(file) === "_headers") return null;
  return fs.existsSync(file) && fs.statSync(file).isFile() ? file : null;
}

http.createServer((request, response) => {
  const urlPath = new URL(request.url, "http://localhost").pathname;
  const file = resolveFile(urlPath);
  const status = file ? 200 : 404;
  const body = fs.readFileSync(file || path.join(ROOT, "404.html"));
  for (const [name, value] of headersFor(urlPath).values()) response.setHeader(name, value);
  response.setHeader("Content-Type", TYPES[path.extname(file || "x.html")] || "application/octet-stream");
  response.writeHead(status);
  response.end(request.method === "HEAD" ? undefined : body);
}).listen(PORT, "127.0.0.1", () => {
  console.log(`serve-dist: http://127.0.0.1:${PORT}`);
});
