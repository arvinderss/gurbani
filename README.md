# Pothi Sahib

An offline Gurbani reader. The whole app — code, styling, and all 31
Banian (137,732 lines, including the complete Sri Guru Granth Sahib Ji and
complete Sri Dasam Granth Sahib) — is one ~14MB HTML file with no
dependencies, no network calls, and nothing to install. It works
identically on Android, iOS, Windows, macOS and Linux: just open it in a
browser.

**To read: open [`dist/pothi-sahib.html`](dist/pothi-sahib.html).** That's
the whole app. Copy it to a phone, email it to yourself, put it on a USB
stick — it doesn't need this repository, a server, or an internet
connection to run.

Everything else in this repository exists so that the Gurbani **text**
underneath that file can be corrected and audited over time without
wrestling with the file itself.

## Why this repository exists

The original build kept everything — including the text of all 9,419
lines — as a single 1.3MB line of JSON inside the HTML file. That's great
for distribution (one file, zero setup) but terrible for maintenance: a
one-character correction changed an unreadable wall of text, `git diff`
showed nothing useful, and there was no way to find "Sukhmani Sahib, line
42" in an editor.

This repository splits that apart:

- **`src/content/`** — the readable source of truth. One JSON file per
  Bani, one line per verse-line, plain text. This is what you edit.
- **`src/app/`** — the app's own code (HTML shell, CSS, JS), also as plain
  readable files.
- **`dist/pothi-sahib.html`** — the single-file app, assembled from the
  above. This is what you (or anyone) actually opens to read. It's
  committed to git, so it's always ready to use without a build step.
- **`tools/`** — two small pages that do the assembling and editing, see
  below. Both are plain HTML/JS you open directly in a browser — no Node,
  no npm, no command line, on any platform.

Because content is now separate, readable, per-Bani files, git gives you
real history for free: `git log --follow src/content/sggs/jap-ji-sahib.json`
shows exactly what changed in that Bani and when.

## Correcting or auditing the text

1. Open **[`tools/editor.html`](tools/editor.html)** in any browser (just
   double-click it — no server needed).
2. Load the Bani's JSON file from `src/content/<granth>/<slug>.json`.
3. Edit line text directly. Word offsets are recalculated automatically —
   you never touch them. Click a word to cycle its vishraam (pause) mark.
   Add or delete lines with the buttons under each line.
4. Add a short note describing what changed and why, then **Save**. This
   downloads the corrected JSON file and appends an entry to that Bani's
   `history` (visible in-app under Settings → Changelog).
5. Move the downloaded file into `src/content/<granth>/`, replacing the
   old one. If you'd rather hand-edit a content file directly in a text
   editor instead of using the editor tool, open
   **[`tools/check.html`](tools/check.html)** afterwards and select the
   file(s) you touched — it validates JSON syntax and content correctness
   in isolation (no need to gather the whole project first) and tells you
   immediately whether the file will load correctly in the app.
6. Rebuild the distributable app (below) — this validates everything
   together (including things a lone-file check can't catch, like a
   section index that doesn't exist).
7. Commit the change: `git add -A && git commit -m "..."`. The diff will
   show exactly the lines you touched.

A reader can also flag a line from inside the app itself (🚩 button, or
press `F`, while reading) with a short note — e.g. "this vishraam looks
wrong". These flags stay on that person's device; **Settings → My Flags**
has a "copy all as text" button so they can be handed to whoever does the
next audit pass.

## Rebuilding `dist/pothi-sahib.html`

Whenever `src/content/` or `src/app/` changes, the distributable file
needs rebuilding. Two ways, pick whichever you have:

- **No setup (recommended):** open **[`tools/build.html`](tools/build.html)**
  in a browser, pick the `src/` folder when prompted, review the
  validation results, click **Build**, then **Download**. Replace
  `dist/pothi-sahib.html` with the downloaded file.
- **If you have Node.js installed:** `node tools/build-node.js` does the
  same thing from the command line and writes `dist/pothi-sahib.html`
  directly. This is optional — it exists only as a shortcut and uses the
  exact same logic (`tools/build-lib.js`) as the browser tool, so the two
  can never disagree.

Either way, the build **validates before it builds**: mismatched slugs,
out-of-range vishraam marks, a Bani missing from the manifest, and similar
mistakes are reported and stop the build rather than silently shipping a
broken file.

## File layout

```
dist/pothi-sahib.html         ← open this to read. Generated — don't hand-edit.
src/
  content/
    manifest.json             ← which granths exist, their display order, the Nitnem list
    dasam/*.json               ← one file per (curated) Bani in Sri Dasam Granth Sahib
    dasam/complete/             ← the complete Dasam Granth, chunked one file per page — see below
    sggs/*.json                 ← one file per (curated) Bani in Sri Guru Granth Sahib Ji
    sggs/complete/               ← the complete SGGS, chunked one file per Ang — see below
    panthic-compilations/*.json ← Ardaas, Rehras recensions, Aartis, etc.
  app/
    head.html, body.html      ← the HTML shell
    styles.css                ← all styling
    app.js                    ← all app logic
tools/
  build.html, build-lib.js    ← the build tool (no install needed)
  build-node.js                ← optional Node.js shortcut for the same build
  editor.html                  ← the content editor (no install needed)
  check.html                    ← standalone JSON/content checker for one file at a time (no install needed)
  inline-build-lib.js           ← maintenance script: re-embeds build-lib.js into the three tools above
```

### Large Banis: chunked (composite) content files

A Bani is normally one file: `content/<granth>/<slug>.json`. For a Bani too
large to review sensibly as one file — the complete SGGS is 60,555 lines —
it's instead a **directory**: `content/<granth>/<slug>/`, containing:

- `_meta.json` — the Bani's own fields (`slug`, `name`, `state`, `source`,
  `history`, `sections`) exactly like a normal content file, just without
  `lines`.
- `ang-0001.json`, `ang-0002.json`, … — one file per Ang/page, each just
  `{"page": N, "lines": [...]}`.

At build time these are concatenated, in filename order, into that Bani's
`lines` array — the app never knows the difference. A correction to Ang 253
is a five-line diff in one small file, not a search through a 60,000-line
document. `tools/build.html`, `tools/build-node.js` and `tools/editor.html`
all read and write this form the same as a single-file Bani.

The build also keeps these two complete Granths **out of the boot-time
JSON**: each above a 3000-line threshold gets its own inline
`<script id="kosh-data-bani-<slug>">` block, which the app parses only when
that Granth is actually opened (`ensureBaniLines()` in `src/app/app.js`).
Word offsets are likewise never embedded any more — the app derives them
on demand the first time each line is rendered. Both changes together cut
the eagerly-parsed payload from ~16M characters of JSON to a ~0.5M
character stub, so a low-end phone parses the whole app in a few
milliseconds and only pays the ~30ms parse for a Granth when they open it.

### Content file schema

```jsonc
{
  "slug": "jap-ji-sahib",
  "name": "ਜਪੁ ਜੀ ਸਾਹਿਬ · Jap Ji Sahib",
  "granthSlug": "sggs",           // must match the folder it lives in
  "state": "PROVISIONAL",          // or "REVIEWED", once checked against a printed edition
  "source": { "name": "...", "license": "...", "attribution": "...", "url": "..." },
  "history": [                     // one entry per correction pass — the audit trail
    { "date": "2026-09-16", "versionNo": 1, "note": "Imported from the Shabad OS database." }
  ],
  "reviewNotes": [                 // optional: known issues, shown to readers in-app
    { "lineIndex": 22, "note": "Double space in source — verify against a printed edition." }
  ],
  "sections": [ { "t": "BANI_SECTION", "l": "1" } ],
  "lines": [
    { "t": "ੴ ਸਤਿ ਨਾਮੁ ..." },     // "s": section index (omitted = 0), "v": vishraam marks (word-index based)
    ...
  ]
}
```

Word offsets and the old per-line hash (`h`) are **not** stored here — the
app computes word boundaries on demand at render time (a one-time cost, in
memory, per line), and `h` was unused dead weight inherited from the
original data source. Vishraam marks (`v`) are stored as `[wordIndex, kind]`
pairs (`kind`: 0 = short, 1 = medium, 2 = long) rather than raw character
offsets, so they survive an ordinary text correction elsewhere in the line.

## Known limitations

- **Reading position and bookmarks are line-index based.** If a
  correction pass inserts or deletes a line partway through a Bani,
  anyone's saved bookmark past that point in that Bani will point at the
  wrong line until they re-find their place. This is a pre-existing
  design tradeoff carried over from the original app, not something this
  restructuring introduced or fixed — inserting/deleting lines is
  uncommon enough (as opposed to editing a line's text in place, which is
  unaffected) that it wasn't judged worth the added complexity of a more
  robust addressing scheme.
- The `ardaas` Bani has two review notes seeded from the original import
  (a double space, and one vishraam mark that didn't align to a word) —
  see `src/content/panthic-compilations/ardaas.json`, or the ⚠ note
  in-app. These were found, not fixed, during migration; they're the
  first real items for someone doing a printed-edition audit pass.

## Provenance

Text originally adopted from the [Shabad OS database](https://github.com/shabados/shabados)
(shabados.com), which identifies Gurbani text as public domain; see each
Bani's `source` field for the specific attribution. All Banian are marked
`PROVISIONAL` until checked line-by-line against a printed edition — this
repository exists to make that checking process practical over time.
