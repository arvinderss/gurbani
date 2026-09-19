# Pothi Sahib

An offline Gurbani reader. The whole app — code, styling, and all 32
Banian (138,063 lines, including the complete Sri Guru Granth Sahib Ji,
the complete Sri Dasam Granth Sahib and the English Sikh Rehat Maryada) —
is one ~14.6MB HTML file with no dependencies, no network calls, and
nothing to install. It works identically on Android, iOS, Windows, macOS
and Linux: just open it in a browser.

**To read: open [`dist/pothi-sahib.html`](dist/pothi-sahib.html).** That's
the whole app. Copy it to a phone, email it to yourself, put it on a USB
stick — it doesn't need this repository, a server, or an internet
connection to run.

There's also a hosted copy, rebuilt from `main` on every push:
**[read it live at arvinderss.github.io/gurbani](https://arvinderss.github.io/gurbani/)**.

**Android:** grab the signed installer from the
**[`apk` release](https://github.com/arvinderss/gurbani/releases/tag/apk)** —
it's the same single file wrapped in an offline WebView app (no
permissions, no network), with the same launcher icon. It's rebuilt and
re-signed on every push to `main`, so it updates in place. Build it
yourself with `cd android && ./gradlew assembleRelease`.

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
- **`tools/`** — a small set of standalone pages for assembling, editing,
  checking and reviewing, see below. Each is plain HTML/JS you open
  directly in a browser — no Node, no npm, no command line, on any
  platform.

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

`tools/editor.html` also edits `src/content/manifest.json`: the **Manifest**
mode lets you choose which compiled Bani fills a Granth in the two complete
scriptures (it warns if that Bani is already used elsewhere in the
manifest), reorder the Granths, and save a manifest that the build's own
validator (`PothiBuild.validateManifest`) approves before it downloads.

A reader can also flag a line from inside the app itself (🚩 button, or
press `F`, while reading) with a short note — e.g. "this vishraam looks
wrong". These flags stay on that person's device until they act on them.

### Turning reader flags into fixes (the review workflow)

1. In the app, open **Settings → My Flags → Export for review** to
   download `pothi-sahib-flags.json` (one entry per flag, with the line
   text exactly as it was when flagged). Hand that file — or email it — to
   whoever runs the next audit; it carries no reading history.
2. On the reviewer's machine, open **[`tools/review.html`](tools/review.html)**:
   load the flags file, optionally pick the `src/content` folder (to see
   the *current* source text at each flagged line) and an earlier decision
   log to resume, then resolve every line as **Keep as-is / ✎ Fix /
   ✗ Reject** (with a corrected text or a reason).
3. The tool downloads a durable **`review-log-<date>.json`** (the complete
   decision record, resumable) plus, when `src/content` was loaded, the
   corrected Bani or chunk `.json` files — each with a new `history` entry
   appended, so the fix shows up in the app's Settings → Changelog view.
4. Move the corrected files back into `src/content/` (replacing the
   originals), rebuild `dist/`, and commit. The `history` entry explains
   what the review changed and why; the log keeps a permanent record even
   for flags that were rejected.

Two of those steps can alternatively be done without the review tool at
all: a flag's **📋 Copy all as text** button turns the list into pasteable
plain text, and `editor.html` remains the tool for surgical, line-by-line
edits.

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
    rehat-maryada/*.json         ← the English Sikh Rehat Maryada (one file, 13 chapters)
  app/
    head.html, body.html      ← the HTML shell
    styles.css                ← all styling
    fonts.css                 ← embedded Gurmukhi webfonts as base64 @font-face (generated, keep committed)
    app.js                    ← all app logic
tools/
  build.html, build-lib.js    ← the build tool (no install needed)
  build-node.js                ← optional Node.js shortcut for the same build
  make-fonts.js                ← regenerates src/app/fonts.css from the fonts below
  fonts/                       ← bundled OFL woff2 fonts + licence files (committed, so builds are offline)
  editor.html                  ← the content editor + manifest editor (no install needed)
  check.html                    ← standalone JSON/content checker for one file at a time (no install needed)
  review.html                   ← resolves reader flags into fixes + a decision log (no install needed)
  inline-build-lib.js           ← maintenance script: re-embeds build-lib.js into the three build-lib tools above
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

## Security

A named review pass (2026-09-19) audited the app and its tooling against
security-by-design. What holds by construction, and what was tightened:

- **Nothing to intercept, nothing to exfiltrate.** The app makes zero
  network calls and the Android build declares no permissions — there is
  no `INTERNET` permission at all. All state lives in a single
  `localStorage` key, and every piece of text (Gurbani or otherwise) is
  inserted with `textContent`, never `innerHTML`.
- **Strict CSP, enforced twice.** The built file has a strict
  Content-Security-Policy in its `<head>` (default-src `'none'`,
  inline-only scripts/styles, `data:` images and `data:` fonts). The
  hosted copy adds the same policy — plus `frame-ancestors 'none'`,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`,
  `Cross-Origin-Opener-Policy: same-origin` and a restrictive
  `Permissions-Policy` — via `_headers`, deployed by
  `.github/workflows/deploy-pages.yml`.
- **Backups round-trip without permissions.** The Settings backup Export
  downloads a self-contained `data:` URL (no network, nothing uploaded);
  the Android shell's `DownloadListener` writes it to the device's
  Downloads folder via MediaStore with no storage permission declared.
- **No `</script` can leak.** The build escapes `</script` when a content
  file (or a Granth's inline block) would end up inside a script block, so
  hostile text in a content file can corrupt a build but cannot break out
  of it.
- **Android data stays put.** `android/app/src/main/AndroidManifest.xml`
  sets `android:allowBackup="false"` (and `fullBackupContent="false"`), so
  reader flags, notes and reading positions aren't swept into OS/ADB
  backups.
- **App dialogs work everywhere.** The app never calls `alert()` or
  `confirm()` — a bare WebView has no WebChromeClient, so native JS dialogs
  are silent on Android. All messages go through the app's own `<dialog>`
  helpers instead.
- **Backups are sanitised on restore.** `src/app/app.js` has
  `sanitizeSettings()` (shape-match against `DEFAULTS`) and
  `sanitizeBackup()` (per-item whitelists: bounded bookmark/flag counts,
  lengths and coerced numbers), so a hand-edited or hostile backup file
  can hand the app wrong-typed or oversized data.
- **The tools are sandboxed too.** `tools/*.html` carry the same strict
  CSP as the app and only ever render text.

## Provenance

Text originally adopted from the [Shabad OS database](https://github.com/shabados/shabados)
(shabados.com), which identifies Gurbani text as public domain; see each
Bani's `source` field for the specific attribution. All Banian are marked
`PROVISIONAL` until checked line-by-line against a printed edition — this
repository exists to make that checking process practical over time.

The Sikh Rehat Maryada is transcribed separately from the SGPC Dharam
Parchar Committee's English edition (SGPC, Amritsar, English ed. 1997);
it is `PROVISIONAL` the same way and carries its own attribution in
`src/content/rehat-maryada/sikh-rehat-maryada.json`.
