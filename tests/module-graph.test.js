#!/usr/bin/env node
// Guardrail: the src/*.mjs import graph must stay acyclic. The decomposition relies on a strict
// one-directional layering (leaves -> matching/filter-panel -> render-* -> selection -> app -> test-hooks);
// a cycle would also break the blob-URL module loader in tests/browser-test-utils.js.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const srcDir = path.resolve(__dirname, '..', 'src');
const graph = new Map();
for (const file of fs.readdirSync(srcDir).filter(name => name.endsWith('.mjs'))) {
  const source = fs.readFileSync(path.join(srcDir, file), 'utf8');
  const deps = [...source.matchAll(/from\s+["']\.\/([\w-]+)\.mjs["']/g)].map(match => `${match[1]}.mjs`);
  graph.set(file, deps);
}

// Depth-first search that returns the first import cycle found, or null.
function findCycle() {
  const visiting = new Set();
  const done = new Set();
  const stack = [];
  let cycle = null;
  function visit(node) {
    if (cycle) return;
    visiting.add(node);
    stack.push(node);
    for (const dep of graph.get(node) || []) {
      if (!graph.has(dep)) continue;
      if (visiting.has(dep)) { cycle = [...stack.slice(stack.indexOf(dep)), dep]; return; }
      if (!done.has(dep)) visit(dep);
      if (cycle) return;
    }
    stack.pop();
    visiting.delete(node);
    done.add(node);
  }
  for (const node of graph.keys()) {
    if (!done.has(node)) visit(node);
    if (cycle) break;
  }
  return cycle;
}

const cycle = findCycle();
assert.equal(cycle, null, `src module graph has an import cycle: ${cycle ? cycle.join(' -> ') : ''}`);
console.log(`✓ ${graph.size} src modules form an acyclic import graph`);
console.log('\n1/1 module-graph check passed.');
