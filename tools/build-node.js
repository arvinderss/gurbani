#!/usr/bin/env node
/**
 * Optional convenience wrapper around build-lib.js for anyone who does have
 * Node.js handy and would rather run one command than use tools/build.html.
 * This is NOT required - tools/build.html does the same build with nothing
 * installed, which is the supported path for most people. This script uses
 * the exact same build-lib.js so the two paths can never drift apart.
 *
 * Usage: node tools/build-node.js
 * Reads from ../src, writes ../dist/pothi-sahib.html
 */
const fs = require('fs');
const path = require('path');
const PothiBuild = require('./build-lib.js');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const CONTENT = path.join(SRC, 'content');

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

const manifest = readJson(path.join(CONTENT, 'manifest.json'));

// A Bani is either content/<granth>/<slug>.json (one file), or
// content/<granth>/<slug>/ (a directory: _meta.json for the Bani's own
// fields, plus any number of chunk files - e.g. ang-0001.json - each
// {"lines":[...]}, concatenated in filename order). The second form exists
// for very large Banian (a complete Granth) so no single file balloons
// past what's reasonable to review a diff of.
function loadComposite(dir) {
  const meta = readJson(path.join(dir, '_meta.json'));
  const chunkFiles = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json') && f !== '_meta.json')
    .sort();
  const lines = [];
  for (const f of chunkFiles) {
    const chunk = readJson(path.join(dir, f));
    lines.push(...chunk.lines);
  }
  return { ...meta, lines };
}

const baniBySlug = new Map();
const problems = [];
for (const granth of manifest.granths) {
  const dir = path.join(CONTENT, granth.slug);
  if (!fs.existsSync(dir)) {
    problems.push(`Folder missing for granth "${granth.slug}": ${dir}`);
    continue;
  }
  for (const entry of fs.readdirSync(dir)) {
    const entryPath = path.join(dir, entry);
    let bani, where;
    if (fs.statSync(entryPath).isDirectory()) {
      bani = loadComposite(entryPath);
      where = `${granth.slug}/${entry}/`;
    } else if (entry.endsWith('.json')) {
      bani = readJson(entryPath);
      where = `${granth.slug}/${entry}`;
      const slugFromFile = entry.slice(0, -5);
      if (bani.slug !== slugFromFile) {
        problems.push(`${where}: file name "${entry}" does not match its "slug" field ("${bani.slug}").`);
      }
    } else {
      continue;
    }
    const fileProblems = PothiBuild.validateBani(bani, granth.slug);
    problems.push(...fileProblems);
    PothiBuild.registerBani(baniBySlug, problems, bani, where);
  }
}
problems.push(...PothiBuild.validateManifest(manifest, baniBySlug));

if (problems.length) {
  console.error(`Found ${problems.length} problem(s):\n`);
  for (const p of problems) console.error(' - ' + p);
  console.error('\nFix these before building.');
  process.exit(1);
}

const data = PothiBuild.buildKoshData(manifest, baniBySlug);
const html = PothiBuild.assembleHtml({
  headHtml: fs.readFileSync(path.join(SRC, 'app', 'head.html'), 'utf8'),
  styleCss: fs.readFileSync(path.join(SRC, 'app', 'styles.css'), 'utf8'),
  bodyHtml: fs.readFileSync(path.join(SRC, 'app', 'body.html'), 'utf8'),
  appJs: fs.readFileSync(path.join(SRC, 'app', 'app.js'), 'utf8'),
  data,
});

const outPath = path.join(ROOT, 'dist', 'pothi-sahib.html');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, html, 'utf8');

const totalLines = data.banis.reduce((n, b) => n + b.lines.length, 0);
console.log(`Built ${outPath}`);
console.log(`${data.banis.length} Banian, ${totalLines} lines, ${(Buffer.byteLength(html, 'utf8') / 1024 / 1024).toFixed(2)} MB.`);
