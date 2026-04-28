// =============================================================================
// K-PHI SDK — Build Script
// =============================================================================
// Produces three distribution targets:
//   dist/kphi-sdk.umd.js       — full SDK bundle (Node + browser)
//   dist/ui-helpers.umd.js     — UI helpers only (browser, CDN)
//   dist/kphi-sdk.esm.js       — ESM bundle for modern toolchains
// =============================================================================

const esbuild = require('esbuild');
const fs      = require('fs');
const path    = require('path');

const pkg = require('../package.json');

// Ensure dist/ exists
fs.mkdirSync(path.join(__dirname, '../dist'), { recursive: true });

const banner = `/*!
 * @kphi/sdk v${pkg.version}
 * K-Phi Module Development SDK
 * (c) K-Phi Kft — All rights reserved
 * https://k-phi.com/developers
 */`;

const shared = {
  bundle:    true,
  minify:    false,
  sourcemap: true,
  banner:    { js: banner },
  external:  ['js-yaml', 'ajv', 'path', 'fs'],  // keep Node built-ins external
};

async function build() {
  console.log(`Building @kphi/sdk v${pkg.version}...`);

  // ── 1. Full SDK — UMD (works in Node and browser via <script> tag) ─────────
  await esbuild.build({
    ...shared,
    entryPoints: ['src/index.js'],
    outfile:     'dist/kphi-sdk.umd.js',
    format:      'iife',
    globalName:  'KPhiSDK',
    platform:    'neutral',
  });
  console.log('  ✓ dist/kphi-sdk.umd.js');

  // ── 2. UI helpers only — UMD (slim browser bundle for dev portal / CDN) ────
  await esbuild.build({
    ...shared,
    entryPoints: ['src/ui-helpers.js'],
    outfile:     'dist/ui-helpers.umd.js',
    format:      'iife',
    globalName:  'KPhiUI',
    platform:    'browser',
    external:    [],  // fully self-contained for CDN use
  });
  console.log('  ✓ dist/ui-helpers.umd.js');

  // ── 3. ESM bundle — for modern bundlers (Vite, Rollup, etc.) ───────────────
  await esbuild.build({
    ...shared,
    entryPoints: ['src/index.js'],
    outfile:     'dist/kphi-sdk.esm.js',
    format:      'esm',
    platform:    'neutral',
  });
  console.log('  ✓ dist/kphi-sdk.esm.js');

  // ── 4. Print sizes ──────────────────────────────────────────────────────────
  const distFiles = fs.readdirSync('dist').filter(f => f.endsWith('.js') && !f.endsWith('.map'));
  console.log('\nBundle sizes:');
  for (const file of distFiles) {
    const size = fs.statSync(`dist/${file}`).size;
    console.log(`  ${file.padEnd(30)} ${(size / 1024).toFixed(1)} KB`);
  }

  console.log('\nBuild complete.');
}

build().catch(err => {
  console.error('Build failed:', err);
  process.exit(1);
});
