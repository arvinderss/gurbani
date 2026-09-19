// Keeps the browser-tab favicon (a data: PNG in src/app/head.html) in sync
// with the logo source of truth: assets/waheguru.png. Run after changing
// the logo, then rebuild dist. Prefers ImageMagick (magick/convert) to emit
// a small 96px render; falls back to inlining the source file as-is.
//
// head.html is regenerated wholesale from the CA_HEAD template below, so a
// broken/corrupted favicon line (raw binary, stray quotes) can never survive
// a re-run: the stale bytes are simply dropped. The template is also the
// definition of the shipped <head>.
// Usage: node tools/make-favicon.js
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const root = path.join(__dirname, '..');
const headPath = path.join(root, 'src', 'app', 'head.html');
const logoPath = path.join(root, 'assets', 'waheguru.png');

const CA_HEAD = (faviconB64) =>
  '    <meta charset="utf-8" />\n' +
  '    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />\n' +
  '    <meta\n' +
  '      http-equiv="Content-Security-Policy"\n' +
  "      content=\"default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; font-src data:; media-src data: blob:; base-uri 'none'; form-action 'none'\"\n" +
  '    />\n' +
  '    <meta name="description" content="Pothi Sahib — offline Gurbani reader for Nitnem and Sri Dasam Granth Sahib." />\n' +
  '    <meta name="author" content="Arvinder Singh" />\n' +
  '    <meta name="theme-color" media="(prefers-color-scheme: light)" content="#fffdf8" />\n' +
  '    <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#1d1d1c" />\n' +
  '    <link\n' +
  '      rel="icon"\n' +
  '      href="data:image/png;base64,' + faviconB64 + '"\n' +
  '    />\n' +
  '    <title>Pothi Sahib</title>\n';

function updateHead(pngBuffer) {
  const b64 = pngBuffer.toString('base64');
  fs.writeFileSync(headPath, CA_HEAD(b64));
  console.log(`Regenerated ${headPath} (favicon base64 ${b64.length} chars).`);
}

function resizeViaMagick(bin) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      bin,
      [logoPath, '-resize', '96x96!', '-strip', 'PNG:-'],
      { maxBuffer: 5 * 1024 * 1024, encoding: 'buffer' },
      (err, stdout) => (err ? reject(err) : resolve(stdout))
    );
    if (child) child.on('error', reject);
  });
}

(async () => {
  const src = fs.readFileSync(logoPath);
  const magick = fs.existsSync('/usr/bin/magick')
    ? ['magick']
    : fs.existsSync('/usr/bin/convert')
      ? ['convert']
      : [];
  for (const bin of magick) {
    try {
      await updateHead(await resizeViaMagick(bin));
      return;
    } catch (e) {
      console.warn(`ImageMagick (${bin}) failed (${e.message}); falling back to source file.`);
    }
  }
  await updateHead(src);
})();