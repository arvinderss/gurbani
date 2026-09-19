# Changelog

This tracks changes to the **project** (structure, app code, tooling).
Changes to specific Gurbani **text** are tracked per-Bani in each content
file's own `history` array, and surfaced in-app under Settings →
Changelog.

## 2026-09-19 — Fix corrupted favicon (garbled text on Android)

- The browser-tab favicon was shipped as raw PNG bytes mangled into a
  ``base64`` attribute (ImageMagick's stdout was read as a *string*, so every
  non-UTF-8 byte became a ``�`` replacement char, and the ``href="base64,…"``
  quoted attribute let a stray `"`/`>` byte break out of the tag — browsers
  then rendered that blob as garbled text at the very top of the screen and
  the unbounded garbage line inflated the page width, pushing the reader's
  size/speed controls out of the visible area). The corrupted file grew on
  every re-run because ``indexOf('"')`` stopped at the stray quote.
- `tools/make-favicon.js` now requests raw bytes from ImageMagick
  (``encoding: 'buffer'``) and regenerates the whole ``<head>`` from a fixed
  template, so stale/corrupt bytes can never survive a re-run. Ran it,
  rebuilt dist: the shipped favicon is again a valid pure-ASCII base64 96×96
  PNG (28,432 chars), and the file contains no ``�`` anywhere.
- Regression guard: the share-smoke and script-integrity harnesses now fail
  if the favicon isn't pure-ASCII base64 that decodes to a PNG, or if any
  ``�`` reaches the shipped file.

## 2026-09-19 — Search refinements, resume marker, My Practice, reminders; Rehat Maryada

- **Search now understands romanised Gurbani and can be scoped to one
  Granth.** A phonetic map (waheguru → ਵਾਹਿਗੁਰੂ, sukhmani → ਸੁਖਮਨੀ, …)
  expands the query before matching, so ASCII typing finds Gurmukhi text;
  when a Latin-only query finds nothing, a "Phonetic matches" section
  re-runs the search in romanised form (noting `Typed "…" — matching
  "…"`). A persisted Granth scope dropdown on Home filters both the Bani
  list and full-text search to one Granth.
- **"You left off here" marker**: the reader now marks the line where a
  resumed Bani continues (shown when continuing an existing read, not on a
  fresh open or an explicit jump), so it's obvious where a session picks up.
- **My Practice dashboard**: a new Home section built from `S.baniLog` —
  current and longest streaks, completions, an active-day grid for the past
  two weeks, per-Bani completion ranking (top 8) and milestone chips.
- **Nitnem reminders without any permission** (no OS notification access):
  Settings → Reminders lets you schedule the Nitnem-morning five-Banian
  read or a single Bani, daily or on chosen weekdays, at a chosen time.
  While the app is open it fires a dialog once per scheduled day; nothing
  ever leaves the device.
- **Rehat Maryada added.** A new "ਰਹਿਤ ਮਰਯਾਦਾ · Rehat Maryada" collection
  carries the English Sikh Rehat Maryada (SGPC Dharam Parchar Committee;
  English ed. 1997) as one Bani organised by its thirteen chapters, 331
  lines / 9,901 words. Marked `PROVISIONAL` pending line-by-line comparison
  with the printed booklet. Dist is now 32 Banian / 138,063 lines / ~14.5MB.
- **Waheguru (Ik Onkar) emblem** replaces the open-book mark everywhere:
  the in-app bar and Home hero, the share-card header, the browser favicon
  and the Android launcher icons (`tools/make-favicon.js` now syncs the
  favicon from `assets/waheguru.png`; the old `assets/logo.svg` is gone).

## 2026-09-19 — Security review and hardening

A full pass over the app and its tooling's security posture. Findings
confirmed as already correct, plus the gaps found and closed:

- **Already correct** — the app is fully offline (zero network calls, no
  `INTERNET` permission), keeps all state in one `localStorage` key,
  renders every line via `textContent` (never `innerHTML`), escapes
  `</script` at build time, and ships a strict CSP in the HTML `<head>`.
- **Android backups off** (`android/app/.../AndroidManifest.xml`): set
  `android:allowBackup="false"` (and `fullBackupContent="false"`) — reader
  flags, notes and reading positions are private to the app and no longer
  ride along in OS/ADB backups.
- **No JS alert()/confirm() left** (`src/app/app.js`): a bare WebView has
  no WebChromeClient, so native `alert()`/`confirm()` are no-ops on
  Android. All five call sites (reset-settings confirm, flag/share
  clipboard fallbacks, backup-restore results) now use the app's own
  `<dialog>` helpers (`dialogBox` / `confirmBox`), so every message
  renders on every platform.
- **Hosted copy sends security headers**: new `_headers`, copied into the
  Pages build by `deploy-pages.yml`, sets `Content-Security-Policy` with
  `frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: no-referrer`, `Cross-Origin-Opener-Policy: same-origin`
  and a restrictive `Permissions-Policy`.
- **Backup restore hardened** (`sanitizeBackup()` in `src/app/app.js`):
  a backup is validated per-item before it touches state — bookmarks must
  be `{at: number, text: string}` with text bounded (≤ 80 chars) and a
  5000-item cap; flags must match `{slug, lineIndex, text, note, at}` with
  text/note length caps and a 2000-item cap. Malformed or hostile items
  are dropped or coerced to sane values instead of being restored.

## 2026-09-19 — Reading tools: Go-to-Ang, ranked search, My Bookmarks

- **Go-to-Ang**: type a number in the Home search box and jump straight to
  that Ang of Sri Guru Granth Sahib Ji (or the Dasam Granth) — numbered
  `.nav-chip` shortcuts appear above the results, and the reader shows which
  Ang it's on. `angToFirstIndex` maps the RLE ang index to the first line
  of each page.
- **Ranked full-text search**: results sort by (1) exact whole-line match,
  (2) exact phrase / first-letters match, (3) substring, (4) any
  word-token match, broken by SGGS → Dasam → Panthic → other order, then
  Ang, then line. Every result shows the Ang it came from.
- **My Bookmarks on Home**: a section listing every bookmarked line
  (newest first, capped at 200) with remove and jump-straight-back-into-
  the-reader buttons. Uses the same jump as Continue Reading, so it works
  for the long deferred Granths too.

## 2026-09-19 — Reader-flag review workflow; manifest editing; in-app changelog

- **App → tool handoff**: Settings → My Flags gained "📤 Export for
  review", producing `pothi-sahib-flags.json` (each flag with its captured
  line text, note, slug and Granth). The empty state also says where flags
  go.
- **New `tools/review.html`** (zero install, like the other tools):
  imports a flags file and, optionally, the `src/content` folder and an
  earlier decision log to resume. Each flagged line shows both the flagged
  text and the current source text (warning when a later edit shifted
  them), and is resolved as **Keep as-is / ✎ Fix / ✗ Reject**. It downloads
  a durable `review-log-<date>.json`, and when the content folder was
  loaded, the corrected Bani/chunk `.json` files with a new `history`
  entry appended — so a fix lands in the app's Settings → Changelog on the
  next build. Its pure flag→chunk mapping is exposed as `PothiReview` and
  covered by the tool-verify harness.
- **Manifest editor**: `tools/editor.html` gained a Manifest mode — pick
  the compiled Bani that fills a Granth of the complete scriptures (with a
  warning if that Bani is already used elsewhere in the manifest), reorder
  Granths, and save a manifest.json that is validated by the real build
  logic (`PothiBuild.validateManifest`) before it downloads.
- **In-app changelog**: Settings → Changelog now leads with an "App —
  recent changes" section (from `APP_CHANGES` in app.js) documenting
  app-level updates, above the existing per-Bani history.

## 2026-09-19 — Android install package, new brand emblem, hosted copy

- **Android app** (`android/`): the built single file ships as an offline
  WebView app (no permissions, no network). A GitHub Actions workflow
  (`build-apk.yml`) assembles and signs a release APK on every push and
  publishes it to the `apk` GitHub Release, stable across updates.
- **Hosted copy**: a `deploy-pages.yml` workflow rebuilds `dist/` on every
  push and publishes it at https://arvinderss.github.io/gurbani/.
- **New logo**: the Waheguru (Ik Onkar) emblem from `assets/waheguru.png`
  on a transparent background. Source of truth is that PNG, shared by the
  in-app mark (256p render, inlined as a data URI), the browser favicon
  (synced via `tools/make-favicon.js`), and the Android launcher icons.
- CSP now allows `media-src data: blob:` so the keep-awake fallback video
  plays inside the WebView APK (which has no Screen Wake Lock API).

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
