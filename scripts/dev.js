#!/usr/bin/env node
// =============================================================================
// K-PHI SDK — Dev Server
// =============================================================================
// Spins up a local K-Phi shell with your module loaded inside it.
// Same colors, same layout, same fonts — what your users will actually see.
//
// Usage:
//   npx kphi-dev                 (from your module directory)
//   npx kphi-dev --port 4000     (custom port)
// =============================================================================

'use strict';

const http = require('http');
const fs   = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const PORT = parseInt(process.argv.find((a, i) => process.argv[i - 1] === '--port') || '3333');
const MODULE_DIR = process.cwd();

// ── Load manifest ────────────────────────────────────────────────
const manifestPath = path.join(MODULE_DIR, 'manifest.yaml');
if (!fs.existsSync(manifestPath)) {
  console.error('❌ No manifest.yaml found in', MODULE_DIR);
  console.error('   Run this command from your module directory.');
  process.exit(1);
}

let manifest;
try {
  manifest = yaml.load(fs.readFileSync(manifestPath, 'utf8'));
  console.log(`📋 Loaded: ${manifest.name} v${manifest.version} (${manifest.id})`);
} catch (e) {
  console.error('❌ Failed to parse manifest.yaml:', e.message);
  process.exit(1);
}

// ── Locate SDK design files ──────────────────────────────────────
const sdkRoot = path.dirname(path.dirname(__filename));
const shellPath  = path.join(sdkRoot, 'design', 'shell.html');
const tokensPath = path.join(sdkRoot, 'design', 'tokens.css');

if (!fs.existsSync(shellPath) || !fs.existsSync(tokensPath)) {
  console.error('❌ SDK design files not found at', sdkRoot);
  process.exit(1);
}

// ── Find module UI entry point ───────────────────────────────────
// Look for: index.js, ui/index.js, or first screen component
const UI_CANDIDATES = [
  'index.js',
  'ui/index.js',
  'ui.js',
  manifest.ui?.screens?.[0]?.component,
].filter(Boolean);

let uiEntry = null;
for (const candidate of UI_CANDIDATES) {
  const full = path.join(MODULE_DIR, candidate);
  if (fs.existsSync(full)) { uiEntry = candidate; break; }
}

// ── Build shell HTML ─────────────────────────────────────────────
function buildShell() {
  let shell = fs.readFileSync(shellPath, 'utf8');

  const replacements = {
    '{{MODULE_ID}}':      manifest.id,
    '{{MODULE_NAME}}':    manifest.name,
    '{{MODULE_VERSION}}': manifest.version,
    '{{MODULE_LABEL}}':   manifest.ui?.navigation?.[0]?.label || manifest.name,
    '{{MODULE_ICON}}':    manifest.ui?.navigation?.[0]?.icon || '⚙',
    '{{MODULE_TOGGLE}}':  manifest.ui?.toggleLabel || manifest.id.toUpperCase(),
  };

  for (const [key, value] of Object.entries(replacements)) {
    shell = shell.split(key).join(value);
  }

  // Inject module UI script
  if (uiEntry) {
    shell = shell.replace('{{MODULE_SCRIPT}}',
      `<script src="/module-ui/${uiEntry}"></script>`);
  } else {
    // No UI entry — show a placeholder with available calculations
    const calcs = (manifest.calculations?.outputs || []).map(o => o.name).join(', ') || 'none';
    shell = shell.replace('{{MODULE_SCRIPT}}', `
<script>
  document.getElementById('module-root').innerHTML = \`
    <div class="kphi-card">
      <div class="kphi-card-header">⚙ ${manifest.name} — No UI entry found</div>
      <div class="kphi-card-body">
        <p style="color:var(--text-muted);margin-bottom:12px">
          Create one of these files to see your module render here:
        </p>
        <div class="kphi-mono" style="color:var(--kphi-lime);line-height:2">
          index.js<br>ui/index.js<br>ui.js
        </div>
        <p style="color:var(--text-dimmed);margin-top:16px;font-size:12px">
          Calculations: <span class="kphi-code">${calcs}</span>
        </p>
        <p style="color:var(--text-dimmed);margin-top:8px;font-size:12px">
          Test with: <span class="kphi-code">node test.js</span>
        </p>
      </div>
    </div>

    <div class="kphi-card">
      <div class="kphi-card-header">🎨 Component Preview</div>
      <div class="kphi-card-body">
        <div class="kphi-hero"><h1>Sample Header</h1><p>subtitle text</p></div>

        <div style="display:flex;gap:8px;margin:16px 0">
          <button class="kphi-btn kphi-btn-primary">Primary</button>
          <button class="kphi-btn kphi-btn-secondary">Secondary</button>
          <button class="kphi-btn kphi-btn-accent">Accent</button>
          <button class="kphi-btn kphi-btn-sm kphi-btn-primary">Small</button>
        </div>

        <div style="display:flex;gap:6px;margin:12px 0">
          <span class="kphi-badge kphi-badge-pink">Pink</span>
          <span class="kphi-badge kphi-badge-lime">Lime</span>
          <span class="kphi-badge kphi-badge-green">Success</span>
          <span class="kphi-badge kphi-badge-red">Danger</span>
        </div>

        <table class="kphi-table" style="margin:16px 0">
          <thead><tr><th>Entity</th><th>Currency</th><th style="text-align:right">Exposure</th><th style="text-align:right">Hedge %</th></tr></thead>
          <tbody>
            <tr><td>US-HQ</td><td>EUR</td><td style="text-align:right" class="kphi-negative">-350,000</td><td style="text-align:right">71%</td></tr>
            <tr><td>US-HQ</td><td>GBP</td><td style="text-align:right" class="kphi-negative">-200,000</td><td style="text-align:right">90%</td></tr>
            <tr><td>EU-OPS</td><td>USD</td><td style="text-align:right" class="kphi-positive">250,000</td><td style="text-align:right">40%</td></tr>
          </tbody>
        </table>

        <div class="kphi-section">Financial rows</div>
        <div class="kphi-row"><span class="kphi-row-label">Revenue</span><span class="kphi-row-value kphi-positive">1,200,000</span></div>
        <div class="kphi-row"><span class="kphi-row-label">COGS</span><span class="kphi-row-value kphi-negative">(450,000)</span></div>
        <div class="kphi-row kphi-row-total"><span class="kphi-row-label">Gross Profit</span><span class="kphi-row-value">750,000</span></div>

        <div style="display:flex;gap:6px;margin:16px 0">
          <span class="kphi-chip">All</span>
          <span class="kphi-chip active">Active</span>
          <span class="kphi-chip">Matured</span>
        </div>

        <div style="display:flex;gap:16px;margin:16px 0">
          <div><div class="kphi-stat-value kphi-positive">$2.4M</div><div class="kphi-stat-label">Total Hedged</div></div>
          <div><div class="kphi-stat-value kphi-negative">$890K</div><div class="kphi-stat-label">Net Exposure</div></div>
          <div><div class="kphi-stat-value">73%</div><div class="kphi-stat-label">Hedge Ratio</div></div>
        </div>

        <div style="margin-top:16px">
          <input class="kphi-input" placeholder="Sample input" style="margin-right:8px">
          <select class="kphi-select"><option>Option A</option><option>Option B</option></select>
        </div>
      </div>
    </div>
  \`;
</script>`);
  }

  return shell;
}

// ── HTTP Server ──────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.json': 'application/json',
  '.yaml': 'text/yaml',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
};

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];

  // Shell
  if (url === '/' || url === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(buildShell());
    return;
  }

  // Design tokens
  if (url === '/tokens.css') {
    res.writeHead(200, { 'Content-Type': 'text/css' });
    res.end(fs.readFileSync(tokensPath, 'utf8'));
    return;
  }

  // Module UI files
  if (url.startsWith('/module-ui/')) {
    const filePath = path.join(MODULE_DIR, url.replace('/module-ui/', ''));
    if (fs.existsSync(filePath)) {
      const ext = path.extname(filePath);
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'text/plain' });
      res.end(fs.readFileSync(filePath));
    } else {
      res.writeHead(404); res.end('Not found');
    }
    return;
  }

  // Static module files (images, etc.)
  const staticPath = path.join(MODULE_DIR, url);
  if (fs.existsSync(staticPath) && fs.statSync(staticPath).isFile()) {
    const ext = path.extname(staticPath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(fs.readFileSync(staticPath));
    return;
  }

  res.writeHead(404); res.end('Not found');
});

server.listen(PORT, () => {
  console.log('');
  console.log(`  ┌──────────────────────────────────────────┐`);
  console.log(`  │  K-Φ Dev Shell                           │`);
  console.log(`  │                                          │`);
  console.log(`  │  Module:  ${(manifest.name).padEnd(30)}│`);
  console.log(`  │  ID:      ${(manifest.id).padEnd(30)}│`);
  console.log(`  │  Version: ${(manifest.version).padEnd(30)}│`);
  console.log(`  │  UI:      ${(uiEntry || 'none (showing preview)').padEnd(30)}│`);
  console.log(`  │                                          │`);
  console.log(`  │  → http://localhost:${PORT}${' '.repeat(21 - String(PORT).length)}│`);
  console.log(`  │                                          │`);
  console.log(`  └──────────────────────────────────────────┘`);
  console.log('');
});
