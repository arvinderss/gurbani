#!/usr/bin/env node
/**
 * tools/build-lib.js is inlined directly into build.html and editor.html
 * (rather than loaded via <script src>) because CSP's 'self' source is
 * unreliable for file:// origins in Chromium - a maintainer opening these
 * tools by double-clicking could see the build silently fail to load its
 * own logic. Inlining sidesteps the question entirely and, as a bonus,
 * makes each tool page fully self-contained (copy just build.html and it
 * still works).
 *
 * tools/build-lib.js stays the single source of truth. Whenever you edit
 * it, run this to re-embed the change in both HTML tools:
 *   node tools/inline-build-lib.js
 * (This script itself needs Node, but only for maintaining the tools -
 * using the tools themselves never does.)
 *
 * Matching note: build-lib.js's own source contains the literal text
 * "</script>" inside an ordinary comment (about escaping it in output),
 * so the closing tag we replace must be matched as a *bare* line - just
 * "    </script>" with nothing else on it - never as "the next </script>
 * substring found anywhere", or a re-run would truncate mid-file.
 */
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const lib = fs.readFileSync(path.join(DIR, 'build-lib.js'), 'utf8');
const START = '<!-- build-lib.js inlined below - source of truth is tools/build-lib.js; regenerate with `node tools/inline-build-lib.js` -->';
const scriptBlock = `${START}\n    <script>\n${lib}\n    </script>`;

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// First run: the plain external tag. Re-run: our marker through to a bare
// "    </script>" line (not any earlier substring match inside the lib).
const firstRunRe = /<script src="build-lib\.js"><\/script>/;
const rerunRe = new RegExp(esc(START) + '[\\s\\S]*?\\n {4}</script>(?=\\r?\\n)');

for (const file of ['build.html', 'editor.html', 'check.html']) {
  const p = path.join(DIR, file);
  let html = fs.readFileSync(p, 'utf8');
  // Check firstRunRe first: the literal external <script src> tag is an
  // unambiguous "not inlined yet" signal even if the marker comment (which
  // rerunRe also needs) happens to already be present above it.
  if (firstRunRe.test(html)) {
    html = html.replace(firstRunRe, scriptBlock);
  } else if (rerunRe.test(html)) {
    html = html.replace(rerunRe, scriptBlock);
  } else {
    console.error(`${file}: found neither the external <script src="build-lib.js"> tag nor a previous inlined block - nothing to replace.`);
    process.exit(1);
  }
  fs.writeFileSync(p, html);
  console.log(`Updated ${file}`);
}
