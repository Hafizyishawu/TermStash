#!/usr/bin/env node
// Assembles the deployable site into dist/. Only files the browser needs are
// published: the repository is private, and serving its root would expose
// tests, docs, decision records and CI config on the public web.
// Fails if anything the service worker precaches is missing from the output,
// because a missing file makes the worker's install step fail silently in the
// browser and the site then never works offline.
//
//   node scripts/build-site.js          build dist/
//   node scripts/build-site.js --list   print every file the build produces,
//                                       which the deploy checks it received
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "dist");
const SITE_FILES = ["index.html", "app.css", "icon.svg", "manifest.webmanifest", "sw.js", "_headers", "404.html", ".well-known/security.txt"];

function copy(relative) {
  const destination = path.join(OUT, relative);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(path.join(ROOT, relative), destination);
}

function precachedPaths() {
  const source = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
  const list = source.match(/const SHELL = \[([\s\S]*?)\];/);
  if (!list) throw new Error("could not find the SHELL list in sw.js");
  const paths = [...list[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]).filter((p) => p !== "./");
  // An empty result means the list changed shape, not that nothing is
  // precached; without this the missing-file check below would pass vacuously.
  if (!paths.length) throw new Error("found no double-quoted paths in the sw.js SHELL list");
  return paths;
}

function siteFiles() {
  const scripts = fs.readdirSync(path.join(ROOT, "src")).filter((file) => file.endsWith(".js")).sort();
  return [...SITE_FILES, ...scripts.map((file) => `src/${file}`)];
}

if (process.argv.includes("--list")) {
  console.log(siteFiles().join("\n"));
  process.exit(0);
}

fs.rmSync(OUT, { recursive: true, force: true });
for (const file of siteFiles()) copy(file);

const missing = precachedPaths().filter((p) => !fs.existsSync(path.join(OUT, p)));
if (missing.length) {
  console.error(`build-site: service worker precaches files missing from dist/: ${missing.join(", ")}`);
  process.exit(1);
}

const count = fs.readdirSync(OUT, { recursive: true }).filter((p) => fs.statSync(path.join(OUT, p)).isFile()).length;
console.log(`build-site: ${count} files in dist/`);
