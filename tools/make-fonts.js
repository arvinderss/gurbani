// Generates src/app/fonts.css: @font-face rules that embed the bundled
// Gurmukhi webfonts as base64 data: URIs, so the reader's font choices
// visibly differ no matter which fonts happen to be installed on the device.
//
// The font binaries live in tools/fonts/ (SIL OFL 1.1 — see the OFL notice
// and source URLs below), and the generated CSS is committed so builds never
// need network access. Only the Gurmukhi unicode-range subset is embedded per
// weight (:400/:700); latin and other scripts fall back to the device fonts.
// Run after swapping a font file here, then rebuild dist.
// Usage: node tools/make-fonts.js
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const fontDir = path.join(root, 'tools', 'fonts');
const outPath = path.join(root, 'src', 'app', 'fonts.css');

// Target @font-face family name -> [input file stem, weight]
const FONTS = [
  ['Noto Sans Gurmukhi', 'NotoSansGurmukhi-400', 400],
  ['Noto Sans Gurmukhi', 'NotoSansGurmukhi-700', 700],
  ['Noto Serif Gurmukhi', 'NotoSerifGurmukhi-400', 400],
  ['Noto Serif Gurmukhi', 'NotoSerifGurmukhi-700', 700],
  ['Mukta Mahee', 'MuktaMahee-400', 400],
  ['Mukta Mahee', 'MuktaMahee-700', 700],
];

const GURMUKHI_RANGE = 'U+0951-0952, U+0964-0965, U+0A01-0A76, U+200C-200D, U+20B9, U+25CC, U+262C, U+A830-A839';

const SRC = {
  'Noto Sans Gurmukhi': 'https://fonts.google.com/noto/specimen/Noto+Sans+Gurmukhi',
  'Noto Serif Gurmukhi': 'https://fonts.google.com/noto/specimen/Noto+Serif+Gurmukhi',
  'Mukta Mahee': 'https://fonts.google.com/specimen/Mukta+Mahee',
};

const lines = [
  '/*',
  ' * Bundled Gurmukhi webfonts, embedded as base64 so the font choices in',
  ' * Settings → Appearance visibly differ on any device (no network needed).',
  ' *',
  ' * Fonts are licensed under the SIL Open Font License 1.1 and are unchanged',
  ' * except for WOFF2 subsetting by Google Fonts at these sources:',
  ...Object.entries(SRC).map(([fam, url]) => ' *  · ' + fam + ' — ' + url),
  ' * License: https://openfontlicense.org — see tools/fonts/ for the OFL notice.',
  ' */',
];

for (const [family, stem, weight] of FONTS) {
  const b64 = fs.readFileSync(path.join(fontDir, stem + '.woff2')).toString('base64');
  lines.push(
    '',
    '@font-face {',
    "  font-family: '" + family + "';",
    '  font-style: normal;',
    '  font-weight: ' + weight + ';',
    '  font-display: swap;',
    '  src: url(data:font/woff2;base64,' + b64 + ') format(\'woff2\');',
    '  unicode-range: ' + GURMUKHI_RANGE + ';',
    '}',
  );
}

fs.writeFileSync(outPath, lines.join('\n') + '\n');
console.log('Regenerated ' + outPath + ' (' + FONTS.length + ' @font-face blocks, ' + lines.length + ' lines).');