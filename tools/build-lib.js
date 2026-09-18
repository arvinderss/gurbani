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
   * Validate a bare lines array - the checks that make sense even without
   * full Bani context (no slug/sections needed), so a single chunk file
   * (see README "Large Banis") can be checked in isolation. `sectionCount`
   * is optional; when given, out-of-range section indices are also caught.
   */
  function validateLines(lines, where, sectionCount) {
    const problems = [];
    if (!Array.isArray(lines) || lines.length === 0) {
      problems.push(`${where}: "lines" must be a non-empty array.`);
      return problems;
    }
    lines.forEach((line, i) => {
      if (typeof line.t !== 'string' || line.t.trim() === '') {
        problems.push(`${where} line ${i}: empty or missing text.`);
        return;
      }
      const words = deriveWords(line.t);
      if (sectionCount !== undefined && line.s !== undefined && (line.s < 0 || line.s >= sectionCount)) {
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
    return problems;
  }

  /**
   * Validate one Bani's source file. Returns a list of human-readable
   * problem strings; an empty list means the file is safe to build.
   */
  function validateBani(bani, folderGranthSlug) {
    const problems = [];
    const where = bani && bani.slug ? bani.slug : '(unknown slug)';
    if (!bani || typeof bani !== 'object') return ['Not a JSON object.'];
    for (const key of ['slug', 'name', 'granthSlug', 'state', 'source', 'lines']) {
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
    problems.push(...validateLines(bani.lines, where, sectionCount));
    if (!Array.isArray(bani.history) || bani.history.length === 0) {
      problems.push(`${where}: "history" should have at least one entry (e.g. the import record).`);
    }
    return problems;
  }

  /**
   * Add a parsed Bani into the slug -> Bani map, flagging (into `problems`)
   * a second file that claims a slug already used by an earlier one rather
   * than letting it silently overwrite - two content files that disagree
   * about a slug is exactly the kind of thing this should catch, not
   * resolve by "whichever the filesystem happened to read last wins".
   */
  function registerBani(baniBySlug, problems, bani, where) {
    if (!bani || !bani.slug) return;
    if (baniBySlug.has(bani.slug)) {
      problems.push(`${where}: slug "${bani.slug}" is already used by another content file - each Bani needs a unique slug.`);
      return;
    }
    baniBySlug.set(bani.slug, bani);
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
   * Very large Banis (currently the two complete Granths, ~60-70k lines)
   * are moved out of the eagerly-parsed `kosh-data` block into their own
   * `<script id="kosh-data-bani-<slug>">` block that the app parses only
   * when that Bani is actually opened (see src/app/app.js ensureBaniLines).
   * Defined here in one place so the app's own threshold (HEAVY_BANI_LINES
   * in app.js) can never drift from the build's.
   */
  const DEFER_LINE_THRESHOLD = 3000;

  /**
   * Assemble the final DATA object the app consumes (a light stub per Bani;
   * the complete Granths carry only their line count until opened, and word
   * offsets are never materialised - the app computes them lazily from t).
   * Returns { data, deferred } where `deferred` holds the full lines/sections
   * payload for each above-threshold Bani, wrapped by assembleHtml into its
   * own <script> block.
   */
  function buildKoshData(manifest, baniBySlug) {
    const granthName = new Map(manifest.granths.map((g) => [g.slug, g.name]));
    const banis = [];
    const deferred = [];
    for (const g of manifest.granths) {
      for (const slug of g.order) {
        const src = baniBySlug.get(slug);
        if (!src) continue;
        const lines = src.lines.map((line) => {
          const out = { t: line.t };
          if (line.s) out.s = line.s;
          if (line.v && line.v.length) out.v = line.v;
          return out;
        });
        const common = {
          slug: src.slug,
          name: src.name,
          granth: granthName.get(src.granthSlug) || src.granthSlug,
          granthSlug: src.granthSlug,
          state: src.state,
          source: src.source,
          history: src.history || [],
          reviewNotes: src.reviewNotes || [],
        };
        if (lines.length >= DEFER_LINE_THRESHOLD) {
          banis.push({ ...common, deferred: true, lineCount: lines.length });
          deferred.push({ slug: src.slug, sections: src.sections || [], lines });
        } else {
          banis.push({ ...common, sections: src.sections || [], lines });
        }
      }
    }
    return {
      data: {
        builtAt: new Date().toISOString(),
        nitnem: manifest.nitnem || [],
        banis,
      },
      deferred,
    };
  }

  /** Wrap the pieces into the final single-file HTML document. */
  function assembleHtml({ headHtml, styleCss, bodyHtml, appJs, data, deferred = [] }) {
    // </script> can never appear unescaped inside an inline <script> block
    const esc = (s) => s.replace(/<\/script/gi, '<\\/script');
    const dataJson = esc(JSON.stringify(data));
    const deferredBlocks = deferred
      .map(
        (d) =>
          '' +
          '    <script id="kosh-data-bani-' +
          d.slug +
          '" type="application/json">\n' +
          esc(JSON.stringify({ slug: d.slug, sections: d.sections, lines: d.lines })) +
          '\n    </script>',
      )
      .join('\n');
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
      deferredBlocks,
      '    <script>',
      appJs,
      '    </script>',
      '  </body>',
      '</html>',
      '',
    ].join('\n');
  }

  const PothiBuild = { deriveWords, validateLines, validateBani, validateManifest, registerBani, buildKoshData, assembleHtml, DEFER_LINE_THRESHOLD };

  if (typeof module !== 'undefined' && module.exports) module.exports = PothiBuild;
  else root.PothiBuild = PothiBuild;
})(typeof window !== 'undefined' ? window : globalThis);
