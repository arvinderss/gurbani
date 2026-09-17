# Changelog

This tracks changes to the **project** (structure, app code, tooling).
Changes to specific Gurbani **text** are tracked per-Bani in each content
file's own `history` array, and surfaced in-app under Settings →
Changelog.

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
