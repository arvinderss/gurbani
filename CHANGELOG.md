# Changelog

This tracks changes to the **project** (structure, app code, tooling).
Changes to specific Gurbani **text** are tracked per-Bani in each content
file's own `history` array, and surfaced in-app under Settings →
Changelog.

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
