#!/usr/bin/env node
/*
 * Assembles the Tauri frontend (frontendDist = ../src) from the PttChrome web build.
 *
 * Source: ./frontend/{dist,node_modules}
 * Output: ./src/  (index.html + assets/, all local — no CDN, no remote scripts)
 *
 * The webpack build pulls React/jQuery/Bootstrap/Hammer from unpkg via
 * <script src="https://...">. We copy those UMDs locally so the app works inside
 * the Tauri webview without network access to a CDN.
 *
 * Run:  node scripts/build-frontend.js   (after building the upstream web core)
 */
const fs = require('fs');
const path = require('path');

const TAURI_ROOT = path.resolve(__dirname, '..');
const UPSTREAM = path.resolve(TAURI_ROOT, 'frontend');
const DIST = path.join(UPSTREAM, 'dist');
const NM = path.join(UPSTREAM, 'node_modules');
const OUT = path.join(TAURI_ROOT, 'src');

const VENDORS = [
  ['jquery/dist/jquery.min.js', 'jquery.min.js'],
  ['bootstrap/dist/js/bootstrap.min.js', 'bootstrap.min.js'],
  ['bootstrap/dist/css/bootstrap.min.css', 'bootstrap.min.css'],
  ['hammerjs/hammer.min.js', 'hammer.min.js'],
  ['react/umd/react.production.min.js', 'react.production.min.js'],
  ['react-dom/umd/react-dom.production.min.js', 'react-dom.production.min.js'],
];

function log(m) { console.log('[build-frontend] ' + m); }

if (!fs.existsSync(path.join(DIST, 'index.html'))) {
  console.error('ERROR: ' + path.join(DIST, 'index.html') + ' not found.');
  console.error('Build the web core first:');
  console.error('  cd frontend && NODE_OPTIONS=--openssl-legacy-provider npm run build');
  process.exit(1);
}

// Clean output (scaffold demo files included) and rebuild it.
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'assets', 'vendor'), { recursive: true });

// 1. built assets
fs.cpSync(path.join(DIST, 'assets'), path.join(OUT, 'assets'), { recursive: true });
log('copied dist/assets');

// 2. vendor UMDs (local)
for (const [src, dest] of VENDORS) {
  const from = path.join(NM, src);
  if (!fs.existsSync(from)) {
    console.error('ERROR: vendor file missing: ' + from);
    process.exit(1);
  }
  fs.copyFileSync(from, path.join(OUT, 'assets', 'vendor', dest));
}
log('copied ' + VENDORS.length + ' vendor libs');

// 3. index.html: CDN -> local vendor, strip crossorigin
let html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
html = html.replace(/https?:\/\/[^"']*\/([^/"']+\.(?:js|css))/g, 'assets/vendor/$1');
html = html.replace(/\s+crossorigin="[^"]*"/g, '');
fs.writeFileSync(path.join(OUT, 'index.html'), html);
log('wrote index.html');

log('DONE -> ' + OUT);
