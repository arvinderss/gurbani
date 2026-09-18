# Changelog

This tracks changes to the **project** (structure, app code, tooling).
Changes to specific Gurbani **text** are tracked per-Bani in each content
file's own `history` array, and surfaced in-app under Settings →
Changelog.

## 2026-09-19 — Load-time and memory overhaul; issue cleanup (#3, #6, #8; #1/#2 gaps)

Startup is now a fraction of what it was: boot-time JSON dropped from
~16M characters to ~0.5M, and the shipped file from ~23MB to ~14MB.

- **Complete Granths load lazily.** The build no longer puts the two
  complete scriptures (60,555 + 67,758 lines) inside the eagerly-parsed
  `kosh-data` block. Each is now its own inline
  `<script id="kosh-data-bani-<slug>">` block, and the app parses a Granth
  only when it's actually opened (`ensureBaniLines()`, with the result
  cached for the session). Opening one costs a ~30ms parse instead of the
  whole 16MB dump at boot — the fix #3's investigation identified as the
  real bottleneck.
- **Word offsets are no longer embedded at all.** The ~7.7MB of `w` arrays
  is gone from the shipped JSON; the app derives word boundaries on demand
  and caches them per line in memory (`wordSpans`). Big knock-on win for
  peak memory on low-end devices, since a complete Granth only ever has
  the lines it's actually rendered word-spanned.
- **Windowed rendering now extends lazily.** The heavy-Bani path builds a
  small window around the starting line and adds (insert-before/append)
  chunks only as the reader approaches the top/bottom edge of what's built
  — previous fixes still eventually filled the DOM with the entire Granth.
  Scroll-position is compensated when content is inserted above so the
  view doesn't jump. (#7 — still wants a real low-end device spot-check.)
- **Reader teardown actually runs now (#6).** `cleanup` was registered but
  never drained — every Bani open leaked a progress bar, an
  `IntersectionObserver` and a bar-handle button. `render()` now calls
  `drainCleanup()` before building the next view (tears down the previous
  one, cancels a pending heavy-Bani build, bumps `readGeneration` so stale
  background renders abandon).
- **Per-Bani "Unread" control (#8).** Continue Reading, Completed, the
  archive, and every Bani list entry offer a "mark unread" action that
  clears that Bani's reading-position row so next open starts fresh —
  no need to reach ਸੰਪੂਰਨ first.
- **Wake lock released on hide (#1 gap).** When the tab flashes to the
  background, the wake lock (and the muted-video fallback, which would
  otherwise keep chewing battery off-screen) is now released, and
  re-acquired on return if still reading.
- **Keyboard scrolling yields to autoscroll (#2 gap).** PageUp/PageDown,
  Home/End and ↑/↓ are now counted as manual scroll, so autoscroll pauses
  instead of fighting them (touch/wheel/pointer already did).

## 2026-09-18 — Unified reading-state log; ਸੰਪੂਰਨ (Sampuran) completion

Replaced three separate, overlapping state structures (`positions` for
Continue Reading, `bookmarkArchive` for dismissed entries, a half-built
`readingLog`) with **one**: `S.baniLog`, an array of `{slug, start, end,
stage, i}` rows. Every view — Continue Reading, the new Completed list,
the Bookmarks Archive — is purely a query over this one array (latest row
per Bani, filtered by `stage`), not separately-maintained state that could
drift out of sync.

- **ਸੰਪੂਰਨ (Sampuran / "complete") button** at the end of each Bani (each
  Bani gets its own, even inside a combined Nitnem read). Marks that
  reading arc complete.
- **Reaching a Bani's last line on screen also auto-completes it** —
  reciting Gurbani from memory while following along or auto-scrolling is
  normal Sikh practice, so this isn't limited to an explicit tap.
- **A row is reused across multiple sessions** of the same unfinished
  read (day 1 at 10%, day 2 at 25%, etc. all update the same row) — a
  *new* row only starts after the previous one was marked completed, or
  for a Bani never opened before. Keeps the log compact and each "how
  long has this been in progress" figure meaningful.
- New **"ਸੰਪੂਰਨ ਬਾਣੀਆਂ · Completed"** section on Home, with a retention
  window (30/60/90/180/365 days) next to the list it controls.
  Removing an entry archives it (restorable), same as Continue Reading's
  ✕ — both feed the same Bookmarks Archive.
- Dropped the separate `archiveSize` (count-based) setting — with the
  unified model, "archive" is just a stage on a per-Bani row, not an
  unbounded growing list, so there's nothing left to cap by count.

## 2026-09-18 — New Granth Sahib Ji category, collapsible UI, reading tools

- New top-level category **"Granth Sahib Ji"**, holding the two complete
  scriptures, moved out of the `sggs`/`dasam` groupings they previously
  sat in (their content folders moved to `content/granth-sahib-ji/`,
  `granthSlug` updated to match). Renamed per request:
  - Sri Guru Granth Sahib Ji (complete) → "ਧਨ ਧਨ ਸ੍ਰੀ ਗੁਰੂ ਗ੍ਰੰਥ ਸਾਹਿਬ ਜੀ · Dhan Dhan Guru Granth Sahib Ji"
  - Sri Dasam Granth Sahib (complete) → "ਸ੍ਰੀ ਦਸਮ ਗ੍ਰੰਥ ਸਾਹਿਬ ਜੀ · Shri Dasam Granth Sahib Ji"
- Investigated cross-category duplicate content per request: found no
  accidental duplicates. What exists (Benti Chaupai Sahib inside Rehras
  Sahib (S.); Anand Sahib 6-pauris and Salok Mehla 9 inside the SGGS
  Paath Bhog compilations) is standard Gurbani compilation structure, not
  a data error - left as-is since removing the standalone entries would
  break Nitnem/standalone access to them.
- Every collapsible section (Home groups, Settings categories) now uses
  native `<details>`/`<summary>`, state remembered per-device.
- Settings reorganized into logical categories: Typography, Reading
  Behaviour, Vishraam, Appearance & Colours, Speed & Scrolling, My Flags,
  Changelog, Backup & Restore, About.
- Vishraam marks can now be shown/hidden per severity (long/medium/short)
  independently, not just on/off as a whole.
- New "Auto-start on open" setting: auto-scroll begins immediately when a
  Bani is opened/resumed, instead of requiring a manual tap.
- Reading progress % now shows on every Bani list entry everywhere (not
  just Continue Reading).
- New: long-press a line (or right-click on desktop) to add a note, share
  the line as plain text (OS share sheet / clipboard), or share it as a
  themed, bordered image (portrait or landscape, download or share-sheet
  with image files where supported). Text stays selectable - only iOS's
  native long-press callout is suppressed so it doesn't fight the new menu.
- "Definitions/meaning" was requested alongside notes/share but needs a
  translation data source decision first - not included in this pass, see
  project notes.

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
