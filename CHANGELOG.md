# Changelog

This tracks changes to the **project** (structure, app code, tooling).
Changes to specific Gurbani **text** are tracked per-Bani in each content
file's own `history` array, and surfaced in-app under Settings →
Changelog.

## 2026-09-18 — Security/UX audit pass

A full review against code readability, security-by-design, data/workflow
integrity, and UX. Findings and fixes:

- Removed an unused `html:` attribute from the `el()` DOM helper in
  app.js - it set `innerHTML` and was never actually called anywhere, so
  it was a dead XSS footgun rather than a real feature.
- `showShortcuts()` built a table row via `innerHTML` template
  interpolation (safe today, since its data is a hardcoded array, but a
  bad pattern to leave in place); switched to `textContent`.
- `validateBani` didn't require a `source` field, but the app dereferences
  `b.source.name`/`b.source.attribution` unconditionally on the About
  page - a content file missing `source` would build cleanly and then
  crash that page at runtime. Added it to the required-fields check, and
  made the two read sites optional-chain as defense in depth regardless.
- Two content files silently claiming the same `slug` would previously
  just have the later one win the in-memory map with no warning. Added
  `registerBani()` to build-lib.js (used by both build.html and
  build-node.js) so this is now a reported build error instead.
- build-node.js didn't check that a single-file Bani's filename matched
  its own `slug` field (build.html already did) - added it, for parity.
- `tools/build.html` and `tools/editor.html` had no Content-Security-Policy
  at all, unlike the main app. Added a matching strict CSP to both (and
  the new `tools/check.html`). Since CSP's `'self'` source is unreliable
  for `file://` origins in Chromium, `build-lib.js` is now inlined
  directly into all three tool pages instead of loaded via `<script src>`
  - as a bonus this also makes each tool page fully self-contained.
  `tools/inline-build-lib.js` keeps them in sync with `build-lib.js`,
  the single source of truth.
- The Home screen's full-text search re-scanned all 137k+ lines on every
  keystroke with no debounce. Added a 150ms debounce.
- `importBackup()` merged an imported backup's `settings` object directly
  into app state with no shape check - a hand-edited or corrupted backup
  file could hand a wrong-typed value to code downstream that assumes a
  particular shape. Added `sanitizeSettings()`, which keeps only fields
  whose type matches `DEFAULTS`.
- Added `tools/check.html`: a standalone JSON/content checker for a
  single Bani, chunk file, `_meta.json`, or `manifest.json`, so a
  hand-edited file can be verified in isolation without gathering the
  whole project first.

Confirmed by this review and worth stating plainly: the app makes zero
network calls (nothing to intercept), stores nothing outside
`localStorage` under one key, and Gurbani/bani text is only ever inserted
via `textContent` (never `innerHTML`) - so even a corrupted or malicious
content file could not achieve script execution, only visibly wrong text
or a build-time validation failure.

## 2026-09-18 — Complete Sri Guru Granth Sahib Ji and Sri Dasam Granth Sahib

- Added the complete text of both scriptures as two new Banis: **60,555
  lines / 1430 Angs** of Sri Guru Granth Sahib Ji, and **67,758 lines** of
  Sri Dasam Granth Sahib — pulled from the official Shabad OS sqlite
  release (4.8.7), converted from its legacy ASCII encoding via the
  official `gurmukhi-utils` package, and validated line-for-line against
  the Jap Ji Sahib text already in this repo before trusting it at scale.
  No text was generated or guessed — everything here traces back to that
  source database.
- These are stored **chunked one file per Ang/page** under
  `src/content/<granth>/complete/` (a `_meta.json` for the Bani's own
  fields plus `ang-NNNN.json` chunk files, concatenated at build time) so
  a correction to one Ang stays a small, reviewable diff instead of
  touching a single 60,000-line file. See the README's "Content file
  schema" section for the convention. `tools/build.html`,
  `tools/build-node.js` and `tools/editor.html` all understand this form.
  The distributable `dist/pothi-sahib.html` grew from ~1MB to ~22MB as a
  result — still one offline file, just a bigger one.
- Section headings for these two now show their real Raag/composition
  name (e.g. "ਸਿਰੀ ਰਾਗੁ · Siree Raag"), taken from the same source.
- Fixed a real bug this surfaced: section index 0 was being omitted from
  stored lines as a size optimisation, but the renderer had no fallback
  for a missing index and crashed on `sections[undefined]` for any
  multi-section Bani (Asa Ki Var, Rehras Sahib, etc.) — those pages
  rendered as blank. Fixed the renderer to default a missing section
  index to 0, verified against all 31 Banis / 137,732 lines.
- Also, generic auto-numbered section headings ("Section 1", "Section
  2"...) are no longer shown at all — they carried no real information.
  A heading now only appears when a Bani has a real section name.
- Added a "Continue Reading" list on Home showing every Bani with a saved
  position (not just the most recently read one), each independently
  resumable, with reading progress % and a way to dismiss an entry.
- Removed the per-Bani provisional/attribution banner from the reader
  view entirely — it was identical across every Bani and, with 31 of
  them now (two very large), was pure repeated noise. That information
  lives in Settings → About.

## 2026-09-18 — Restructured from a single-file blob

- Split the single 1.3MB inline JSON blob into one readable file per Bani
  under `src/content/`, with word offsets and the (unused) per-line hash
  removed — both are derived automatically at build time instead of being
  hand-maintained.
- Converted vishraam marks from raw character offsets to word-index pairs,
  so they survive an ordinary text correction elsewhere in the line.
- No Gurbani wording was changed. Two pre-existing data issues were found
  and logged as `reviewNotes` on `ardaas` rather than silently "fixed" —
  see the README's Known Limitations section.
- Added `tools/build.html` and `tools/editor.html`: zero-install,
  open-in-any-browser tools to edit content and rebuild the distributable
  app. Added `tools/build-node.js` as an optional Node.js shortcut using
  the same build logic.
- Added in-app features enabled by the restructuring: full-text search
  across all Banian (Settings search box now also searches line text, not
  just Bani names), a Changelog view (Settings → Changelog) reading each
  Bani's `history`, and a reader-facing "flag this line for review"
  button (🚩 / `F` key) with an exportable list (Settings → My Flags).
