#!/usr/bin/env node
// Single-command version bump: updates package.json and propagates the new
// version to every cache-busting reference so they can never drift apart.
// Usage: npm run bump 8.9.0
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const next = process.argv[2];

if (!next || !/^\d+\.\d+\.\d+$/.test(next)) {
  console.error("Usage: npm run bump <major.minor.patch>   e.g. npm run bump 8.9.0");
  process.exit(1);
}

const pkgPath = join(root, "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const prev = pkg.version;

if (!prev) {
  console.error("package.json has no version field to bump from.");
  process.exit(1);
}
if (prev === next) {
  console.error(`Version is already ${next}.`);
  process.exit(1);
}

pkg.version = next;
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

// Files carrying the version: ?v= cache-busting query strings (index.html, manifest,
// sw.js) and the service worker cache name (mlx-<version>).
for (const file of ["index.html", "manifest.webmanifest", "sw.js"]) {
  const path = join(root, file);
  const updated = readFileSync(path, "utf8")
    .replaceAll(`?v=${prev}`, `?v=${next}`)
    .replaceAll(`mlx-${prev}`, `mlx-${next}`);
  writeFileSync(path, updated);
}

// README documents the expected asset version in prose; keep it in lockstep so the
// docs can't drift from the code (the only place the bare version appears in README).
const readmePath = join(root, "README.md");
const readme = readFileSync(readmePath, "utf8");
const updatedReadme = readme.replaceAll(`expected asset version is \`${prev}\``, `expected asset version is \`${next}\``);
writeFileSync(readmePath, updatedReadme);

console.log(`Bumped ${prev} → ${next} (package.json, index.html, manifest.webmanifest, sw.js, README.md).`);
console.log("Run `npm test` to confirm everything is aligned.");
