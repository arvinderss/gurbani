// Keeps the browser-tab favicon (a data: PNG in src/app/head.html) in sync
// with the logo source of truth: assets/waheguru.png. Run after changing
// the logo, then rebuild dist. Prefers ImageMagick (magick/convert) to emit
// a small 96px render; falls back to inlining the source file as-is.
// Usage: node tools/make-favicon.js
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const root = path.join(__dirname, '..');
const headPath = path.join(root, 'src', 'app', 'head.html');
const logoPath = path.join(root, 'assets', 'waheguru.png');

function updateHead(pngBuffer) {
  const b64 = pngBuffer.toString('base64');
  let head = fs.readFileSync(headPath, 'utf8');
  const i = head.indexOf('rel="icon"');
  const j = head.indexOf('href="', i);
  const k = head.indexOf('"', j + 'href="'.length);
  head = head.slice(0, j) + 'href="data:image/png;base64,' + b64 + '"' + head.slice(k + 1);
  fs.writeFileSync(headPath, head);
  console.log(`Updated favicon in ${headPath} (base64 ${b64.length} chars).`);
}

function resizeViaMagick(bin) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      bin,
      [logoPath, '-resize', '96x96!', '-strip', 'PNG:-'],
      { maxBuffer: 5 * 1024 * 1024 },
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
      updateHead(await resizeViaMagick(bin));
      return;
    } catch (e) {
      console.warn(`ImageMagick (${bin}) failed (${e.message}); falling back to source file.`);
    }
  }
  updateHead(src);
})();