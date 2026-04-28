// =============================================================================
// K-PHI SDK — Test Runner
// =============================================================================
// Runs the SDK's own self-tests before any publish.
// Tests the test harness, schema validator, and UI helpers.
// =============================================================================

'use strict';

const path = require('path');
const { createMockCtx, runCalc, validateManifest, createMockSdk } = require('../src/test-harness');

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}: ${err.message}`);
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

async function run() {
  console.log('\n@kphi/sdk self-tests\n');

  // ── createMockCtx ──────────────────────────────────────────────────────────
  console.log('createMockCtx:');

  await test('returns correct tenantId', async () => {
    const ctx = createMockCtx({ tenantId: 'tenant-abc' });
    assert(ctx.tenantId === 'tenant-abc');
  });

  await test('merges params with defaults', async () => {
    const ctx = createMockCtx({ params: { currency: 'EUR' } });
    assert(ctx.params.currency === 'EUR');
    assert(ctx.params.scenarioId === 'base');
    assert(ctx.params.periodStart === '2025-01-01');
  });

  await test('inputs are accessible', async () => {
    const ctx = createMockCtx({ inputs: { liquidity_cf: [{ amount: 1000 }] } });
    assert(ctx.inputs.liquidity_cf[0].amount === 1000);
  });

  await test('db.query returns mock data by table name', async () => {
    const ctx = createMockCtx({
      mockData: { 'kphi_fx_hedge': [{ id: 'h1', amount: 500000 }] }
    });
    const rows = await ctx.db.query('SELECT * FROM kphi_fx_hedge');
    assert(rows.length === 1);
    assert(rows[0].id === 'h1');
  });

  await test('db.query returns empty array for unknown table', async () => {
    const ctx = createMockCtx();
    const rows = await ctx.db.query('SELECT * FROM kphi_fx_unknown');
    assert(Array.isArray(rows) && rows.length === 0);
  });

  await test('core.getEntityHierarchy returns default entities', async () => {
    const ctx = createMockCtx();
    const entities = await ctx.core.getEntityHierarchy();
    assert(entities.length > 0);
    assert(entities[0].id);
    assert(entities[0].type);
  });

  await test('core.getPeriods generates correct period range', async () => {
    const ctx = createMockCtx({ params: { periodStart: '2025-01-01', periodEnd: '2025-03-31' } });
    const periods = await ctx.core.getPeriods();
    assert(periods.length === 3, `Expected 3 periods, got ${periods.length}`);
    assert(periods[0].start_date === '2025-01-01');
    assert(periods[2].start_date === '2025-03-01');
  });

  await test('core.translateCurrency handles same currency', async () => {
    const ctx = createMockCtx();
    const result = await ctx.core.translateCurrency(1000, 'USD', 'USD', '2025-03-31');
    assert(result.amount === 1000);
    assert(result.rate === 1);
  });

  await test('core.translateCurrency handles known pair', async () => {
    const ctx = createMockCtx();
    const result = await ctx.core.translateCurrency(1000000, 'EUR', 'USD', '2025-03-31');
    assert(result.amount === 1082000);
    assert(result.rate === 1.082);
  });

  await test('core.translateCurrency handles inverse rate', async () => {
    const ctx = createMockCtx();
    const result = await ctx.core.translateCurrency(1000000, 'USD', 'EUR', '2025-03-31');
    assert(result.amount > 0);
    assert(result.rate < 1);
  });

  await test('utils.aggregate groups and sums correctly', async () => {
    const ctx = createMockCtx();
    const data = [
      { entity: 'A', ccy: 'EUR', amount: 100 },
      { entity: 'A', ccy: 'EUR', amount: 200 },
      { entity: 'B', ccy: 'USD', amount: 500 },
    ];
    const result = ctx.utils.aggregate(data, ['entity', 'ccy'], ['amount']);
    assert(result.length === 2);
    const a = result.find(r => r.entity === 'A');
    assert(a.amount === 300);
  });

  // ── runCalc ────────────────────────────────────────────────────────────────
  console.log('\nrunCalc:');

  // Write a temporary calculation for testing
  const tmpCalc = path.join(__dirname, '../.tmp-test-calc.js');
  require('fs').writeFileSync(tmpCalc, `
    module.exports = async function testCalc(ctx) {
      const entities = await ctx.core.getEntityHierarchy();
      return entities.map(e => ({
        entity_id: e.id,
        value: 42,
        currency: ctx.params.currency,
      }));
    };
  `);

  await test('runs a calculation and returns rows', async () => {
    const ctx = createMockCtx();
    const result = await runCalc(tmpCalc, ctx);
    assert(Array.isArray(result));
    assert(result.length > 0);
    assert(result[0].value === 42);
  });

  await test('validates output against schema', async () => {
    const ctx = createMockCtx();
    const schema = { fields: [{ name: 'entity_id', type: 'string' }, { name: 'value', type: 'decimal' }] };
    const result = await runCalc(tmpCalc, ctx, schema);
    assert(result.length > 0);
  });

  require('fs').unlinkSync(tmpCalc);

  // ── validateManifest ───────────────────────────────────────────────────────
  console.log('\nvalidateManifest:');

  await test('validates a correct minimal manifest', async () => {
    const fs   = require('fs');
    const yaml = require('js-yaml');
    const os   = require('os');
    const tmpBase = require('os').tmpdir();
    const tmpRoot = require('fs').mkdtempSync(tmpBase + '/kphi-test-');
    const moduleId = 'test-module-sdk';
    const tmpDir = tmpRoot + '/' + moduleId;
    require('fs').mkdirSync(tmpDir);
    const manifestPath = `${tmpDir}/manifest.yaml`;

    // Write a minimal valid manifest with matching id
    fs.writeFileSync(manifestPath, yaml.dump({
      id:          moduleId,
      name:        'Test Module',
      version:     '1.0.0',
      category:    'treasury',
      dataModel:   { coreDependencies: ['core.tenant'] },
      calculations:{ inputs: [], outputs: [] },
      api:         { routes: './api/routes.js' },
      ui:          { slot: 'main-panel', toggleLabel: 'Test' },
    }));

    const result = await validateManifest(manifestPath);
    fs.rmSync(tmpDir, { recursive: true });
    assert(result.valid, `Expected valid, got errors: ${JSON.stringify(result.errors)}`);
  });

  await test('rejects manifest with invalid category', async () => {
    const fs   = require('fs');
    const yaml = require('js-yaml');
    const tmpBase = require('os').tmpdir();
    const tmpRoot = require('fs').mkdtempSync(tmpBase + '/kphi-test-');
    const moduleId = 'test-module-sdk';
    const tmpDir = tmpRoot + '/' + moduleId;
    require('fs').mkdirSync(tmpDir);
    const manifestPath = `${tmpDir}/manifest.yaml`;

    fs.writeFileSync(manifestPath, yaml.dump({
      id:          moduleId,
      name:        'Bad Module',
      version:     '1.0.0',
      category:    'not-a-valid-category',
      dataModel:   { coreDependencies: [] },
      calculations:{},
      api:         { routes: './api/routes.js' },
      ui:          {},
    }));

    const result = await validateManifest(manifestPath);
    fs.rmSync(tmpDir, { recursive: true });
    assert(!result.valid, 'Expected invalid manifest to fail');
  });

  // ── createMockSdk (UI) ────────────────────────────────────────────────────
  console.log('\ncreateMockSdk (UI):');

  await test('registerView accepts valid registration', () => {
    const sdk = createMockSdk();
    sdk.registerView({
      slot:   'main-panel',
      id:     'fx-exposures',
      label:  'FX',
      render: () => '<div>test</div>',
    });
    assert(sdk.getRegistry().length === 1);
    assert(sdk.getRegistry()[0].id === 'fx-exposures');
  });

  await test('registerView throws on missing required field', () => {
    const sdk = createMockSdk();
    let threw = false;
    try {
      sdk.registerView({ slot: 'main-panel', id: 'test' }); // missing label and render
    } catch {
      threw = true;
    }
    assert(threw, 'Expected registerView to throw on missing field');
  });

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);

  if (failed > 0) process.exit(1);
}

run().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
