// Keeps the browser-tab favicon (a data: SVG in src/app/head.html) in sync
// with the logo source of truth: assets/logo.svg. Run after changing the
// logo, then rebuild dist. Usage: node tools/make-favicon.js
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const headPath = path.join(root, 'src', 'app', 'head.html');
const logoPath = path.join(root, 'assets', 'logo.svg');

let svg = fs.readFileSync(logoPath, 'utf8');
svg = svg.replace(/<!--[\s\S]*?-->/g, '');
svg = svg.replace(/\s+/g, ' ').trim();

const encoded = svg
  .replace(/%/g, '%25')
  .replace(/[<>#"]/g, (c) => encodeURIComponent(c))
  .replace(/ /g, '%20');
const uri = 'data:image/svg+xml,' + encoded;

let head = fs.readFileSync(headPath, 'utf8');
if (!/rel="icon"/.test(head)) throw new Error('no rel="icon" in head.html');
head = head.replace(/(rel="icon"\s+href=")[^"]*("\s*\/>)/, `$1${uri}$2`);
fs.writeFileSync(headPath, head);
console.log(`Updated favicon in ${headPath} (${uri.length} chars).`);