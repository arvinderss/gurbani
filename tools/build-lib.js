/**
 * Pure build logic for Pothi Sahib: takes the readable per-Bani source
 * files and assembles the single distributable pothi-sahib.html.
 *
 * No DOM, no network, no Node-only APIs - this file runs unmodified in a
 * browser (tools/build.html loads it with a <script> tag) so the whole
 * toolchain stays "open the HTML file in any browser", nothing to install.
 */
(function (root) {
  'use strict';

  function cps(s) {
    return Array.from(s);
  }

  /** Word boundaries in codepoints, matching the app's own tokeniser. */
  function deriveWords(text) {
    const chars = cps(text);
    const words = [];
    let i = 0;
    while (i < chars.length) {
      if (/\s/.test(chars[i])) {
        i++;
        continue;
      }
      let j = i;
      while (j < chars.length && !/\s/.test(chars[j])) j++;
      words.push([i, j]);
      i = j;
    }
    return words;
  }

  /**
   * Validate one Bani's source file. Returns a list of human-readable
   * problem strings; an empty list means the file is safe to build.
   */
  function validateBani(bani, folderGranthSlug) {
    const problems = [];
    const where = bani && bani.slug ? bani.slug : '(unknown slug)';
    if (!bani || typeof bani !== 'object') return ['Not a JSON object.'];
    for (const key of ['slug', 'name', 'granthSlug', 'state', 'lines']) {
      if (!(key in bani)) problems.push(`${where}: missing required field "${key}".`);
    }
    if (folderGranthSlug && bani.granthSlug && bani.granthSlug !== folderGranthSlug) {
      problems.push(
        `${where}: granthSlug "${bani.granthSlug}" does not match its folder "${folderGranthSlug}".`,
      );
    }
    if (!Array.isArray(bani.lines) || bani.lines.length === 0) {
      problems.push(`${where}: "lines" must be a non-empty array.`);
      return problems;
    }
    const sectionCount = Array.isArray(bani.sections) ? bani.sections.length : 0;
    bani.lines.forEach((line, i) => {
      if (typeof line.t !== 'string' || line.t.trim() === '') {
        problems.push(`${where} line ${i}: empty or missing text.`);
        return;
      }
      const words = deriveWords(line.t);
      if (line.s !== undefined && (line.s < 0 || line.s >= sectionCount)) {
        problems.push(`${where} line ${i}: section index ${line.s} has no matching entry in "sections".`);
      }
      if (line.v) {
        for (const [wordIdx, kind] of line.v) {
          if (wordIdx < 0 || wordIdx >= words.length)
            problems.push(`${where} line ${i}: vishraam word index ${wordIdx} is out of range (line has ${words.length} words).`);
          if (![0, 1, 2].includes(kind))
            problems.push(`${where} line ${i}: vishraam kind ${kind} is not one of 0, 1, 2.`);
        }
      }
    });
    if (!Array.isArray(bani.history) || bani.history.length === 0) {
      problems.push(`${where}: "history" should have at least one entry (e.g. the import record).`);
    }
    return problems;
  }

  /** Validate the manifest against the set of Bani files actually present. */
  function validateManifest(manifest, baniBySlug) {
    const problems = [];
    if (!manifest || !Array.isArray(manifest.granths)) return ['manifest.json: missing "granths" array.'];
    const seenSlugs = new Set();
    for (const g of manifest.granths) {
      if (!g.slug || !g.name || !Array.isArray(g.order)) {
        problems.push(`manifest.json: granth entry ${JSON.stringify(g)} needs slug, name, and order.`);
        continue;
      }
      for (const slug of g.order) {
        if (seenSlugs.has(slug)) problems.push(`manifest.json: Bani "${slug}" is listed in more than one granth order.`);
        seenSlugs.add(slug);
        if (!baniBySlug.has(slug)) problems.push(`manifest.json: "${g.slug}" order references "${slug}", but no such content file was found.`);
      }
    }
    for (const slug of baniBySlug.keys()) {
      if (!seenSlugs.has(slug)) problems.push(`"${slug}" has a content file but is not listed in any manifest.json granth order (it won't appear in the app).`);
    }
    if (manifest.nitnem) {
      for (const slug of manifest.nitnem) {
        if (!baniBySlug.has(slug)) problems.push(`manifest.json: nitnem list references "${slug}", but no such content file was found.`);
      }
    }
    return problems;
  }

  /**
   * Assemble the final DATA object the app consumes, deriving word offsets
   * and resolving each Bani's granth display name from the manifest.
   */
  function buildKoshData(manifest, baniBySlug) {
    const granthName = new Map(manifest.granths.map((g) => [g.slug, g.name]));
    const banis = [];
    for (const g of manifest.granths) {
      for (const slug of g.order) {
        const src = baniBySlug.get(slug);
        if (!src) continue;
        const lines = src.lines.map((line) => {
          const out = { t: line.t, w: deriveWords(line.t) };
          if (line.s) out.s = line.s;
          if (line.v && line.v.length) out.v = line.v;
          return out;
        });
        banis.push({
          slug: src.slug,
          name: src.name,
          granth: granthName.get(src.granthSlug) || src.granthSlug,
          granthSlug: src.granthSlug,
          state: src.state,
          source: src.source,
          history: src.history || [],
          reviewNotes: src.reviewNotes || [],
          sections: src.sections || [],
          lines,
        });
      }
    }
    return {
      builtAt: new Date().toISOString(),
      nitnem: manifest.nitnem || [],
      banis,
    };
  }

  /** Wrap the pieces into the final single-file HTML document. */
  function assembleHtml({ headHtml, styleCss, bodyHtml, appJs, data }) {
    const dataJson = JSON.stringify(data)
      // </script> can never appear unescaped inside an inline <script> block
      .replace(/<\/script/gi, '<\\/script');
    return [
      '<!doctype html>',
      '<html lang="pa">',
      '  <head>',
      headHtml.trim(),
      '    <style>',
      styleCss,
      '    </style>',
      '  </head>',
      bodyHtml.trim(),
      '    <script id="kosh-data" type="application/json">',
      dataJson,
      '    </script>',
      '    <script>',
      appJs,
      '    </script>',
      '  </body>',
      '</html>',
      '',
    ].join('\n');
  }

  const PothiBuild = { deriveWords, validateBani, validateManifest, buildKoshData, assembleHtml };

  if (typeof module !== 'undefined' && module.exports) module.exports = PothiBuild;
  else root.PothiBuild = PothiBuild;
})(typeof window !== 'undefined' ? window : globalThis);
