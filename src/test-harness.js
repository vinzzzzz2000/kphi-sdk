// =============================================================================
// K-PHI SDK — Test Harness
// =============================================================================
// Build and test your module locally without a running K-Phi instance.
// The harness creates a mock ctx that matches exactly what CalcEngine injects.
//
// Usage:
//   const { createMockCtx, runCalc } = require('@kphi/sdk/test-harness');
//
//   const ctx = createMockCtx({
//     tenantId: 'test-tenant',
//     params: { periodStart: '2025-01-01', periodEnd: '2025-12-31', currency: 'USD' },
//     inputs: {
//       liquidity_position: require('./fixtures/liquidity-position.json'),
//     },
//     mockData: {
//       'kphi_fx_hedge_program': require('./fixtures/hedge-programs.json'),
//     }
//   });
//
//   const result = await runCalc('./calculations/exposure-matrix.js', ctx);
//   console.log(result);
// =============================================================================

'use strict';

// =============================================================================
// MOCK CONTEXT FACTORY
// =============================================================================

/**
 * Creates a mock ctx object matching CalcEngine's buildCalcContext() output.
 *
 * @param {object} options
 * @param {string}  options.tenantId   - Defaults to 'test-tenant'
 * @param {object}  options.params     - Calc params (periodStart, periodEnd, currency, etc.)
 * @param {object}  options.inputs     - Upstream module data keyed by manifest input name
 * @param {object}  options.mockData   - Table name → rows array for db.query mock
 * @param {object}  options.entities   - Entity hierarchy rows (overrides default mock)
 * @param {object}  options.rates      - Exchange rate rows (overrides default mock)
 */
function createMockCtx(options = {}) {
  const {
    tenantId  = 'test-tenant',
    params    = {},
    inputs    = {},
    mockData  = {},
    entities  = DEFAULT_ENTITIES,
    rates     = DEFAULT_RATES,
  } = options;

  const mergedParams = {
    periodStart: '2025-01-01',
    periodEnd:   '2025-12-31',
    entityIds:   'all',
    scenarioId:  'base',
    currency:    'USD',
    ...params,
  };

  // ── db mock ────────────────────────────────────────────────────────────────
  const db = {
    _calls: [],
    async query(sql, queryParams = []) {
      this._calls.push({ sql, params: queryParams });

      // Match against mockData by table name found in the SQL
      const tableMatch = sql.match(/FROM\s+([a-z_]+)/i);
      if (tableMatch) {
        const table = tableMatch[1].toLowerCase();
        if (mockData[table]) {
          return applySimpleWhere(mockData[table], sql, queryParams);
        }
      }

      console.warn(`[kphi-sdk/harness] No mock data for query: ${sql.trim().slice(0, 80)}...`);
      return [];
    },
  };

  // ── core mock ──────────────────────────────────────────────────────────────
  const core = {
    async getEntityHierarchy() {
      return entities;
    },

    async getExchangeRates(date) {
      return rates.filter(r => r.rate_date === date || !date);
    },

    async getPeriods() {
      return generatePeriods(mergedParams.periodStart, mergedParams.periodEnd);
    },

    async translateCurrency(amount, from, to, date) {
      if (from === to) return { amount, rate: 1, source: 'identity' };
      const rate = findRate(rates, from, to, date);
      return {
        amount: amount * rate.rate,
        rate:   rate.rate,
        source: rate.source || 'mock',
      };
    },
  };

  // ── utils mock ─────────────────────────────────────────────────────────────
  const utils = {
    rollForward(baseData, periods) {
      // Simple flat roll-forward for testing
      return periods.map(period => baseData.map(row => ({ ...row, period_start: period.start_date })));
    },

    interpolate(data, method) {
      return data; // pass-through for testing
    },

    aggregate(data, groupBy, sumFields) {
      const groups = new Map();
      for (const row of data) {
        const key = groupBy.map(f => row[f]).join('|');
        if (!groups.has(key)) {
          const groupRow = {};
          for (const f of groupBy) groupRow[f] = row[f];
          for (const f of sumFields) groupRow[f] = 0;
          groups.set(key, groupRow);
        }
        const g = groups.get(key);
        for (const f of sumFields) g[f] += (row[f] || 0);
      }
      return Array.from(groups.values());
    },
  };

  return {
    tenantId,
    params: mergedParams,
    inputs,
    db,
    core,
    utils,
  };
}

// =============================================================================
// RUN A CALCULATION
// =============================================================================

/**
 * Loads a calculation function and runs it against a mock context.
 * Validates the output matches the declared schema if provided.
 *
 * @param {string} calcPath   - Path to the calculation JS file
 * @param {object} ctx        - Mock context from createMockCtx()
 * @param {object} schema     - Optional output schema from manifest for validation
 */
async function runCalc(calcPath, ctx, schema = null) {
  const calcFn = require(require('path').resolve(calcPath));

  if (typeof calcFn !== 'function') {
    throw new Error(`${calcPath} does not export a function. Export: module.exports = async function(ctx) { ... }`);
  }

  console.log(`[kphi-sdk/harness] Running: ${calcPath}`);
  const start = Date.now();

  const result = await calcFn(ctx);

  const duration = Date.now() - start;
  console.log(`[kphi-sdk/harness] Completed in ${duration}ms — ${result?.length ?? 'N/A'} rows`);

  if (!Array.isArray(result)) {
    throw new Error(`Calculation must return an array of rows. Got: ${typeof result}`);
  }

  if (schema) {
    validateAgainstSchema(result, schema, calcPath);
  }

  return result;
}

// =============================================================================
// VALIDATE MANIFEST
// =============================================================================

/**
 * Validates a manifest.yaml against the K-Phi manifest schema.
 * Run this before pushing to ensure your module will load correctly.
 *
 * @param {string} manifestPath - Path to manifest.yaml
 */
async function validateManifest(manifestPath) {
  const fs   = require('fs');
  const yaml = require('js-yaml');
  const Ajv  = require('ajv');
  const path = require('path');

  const schema   = require('../schema/manifest-schema.json');
  const raw      = fs.readFileSync(manifestPath, 'utf-8');
  const manifest = yaml.load(raw);

  const ajv      = new Ajv({ allErrors: true });
  const validate = ajv.compile(schema);
  const valid    = validate(manifest);

  if (!valid) {
    console.error(`[kphi-sdk] Manifest validation FAILED: ${manifestPath}`);
    for (const err of validate.errors) {
      console.error(`  ✗ ${err.instancePath || '(root)'}: ${err.message}`);
    }
    return { valid: false, errors: validate.errors };
  }

  // Additional check: manifest.id must match directory name
  const dirName = path.basename(path.dirname(path.resolve(manifestPath)));
  if (manifest.id !== dirName) {
    const msg = `manifest.id "${manifest.id}" must match directory name "${dirName}"`;
    console.error(`[kphi-sdk] ✗ ${msg}`);
    return { valid: false, errors: [{ message: msg }] };
  }

  console.log(`[kphi-sdk] ✓ Manifest valid: ${manifest.id} v${manifest.version}`);
  return { valid: true, manifest };
}

// =============================================================================
// UI REGISTRATION MOCK
// =============================================================================

/**
 * Mock SDK registry for testing UI registration.
 * Use this to verify your registerView() calls without the K-Phi shell.
 */
function createMockSdk() {
  const registry = [];

  return {
    registerView(registration) {
      const required = ['slot', 'id', 'label', 'render'];
      for (const field of required) {
        if (!registration[field]) throw new Error(`registerView: missing required field "${field}"`);
      }
      registry.push(registration);
      console.log(`[kphi-sdk/harness] Registered view: ${registration.id} → slot:${registration.slot}`);
    },

    getRegistry() {
      return [...registry];
    },
  };
}

// =============================================================================
// INTERNAL HELPERS
// =============================================================================

function applySimpleWhere(rows, sql, params) {
  // Very basic WHERE emulation for mock queries
  // Only handles = comparisons against $1, $2, etc.
  const whereMatch = sql.match(/WHERE\s+(.+?)(?:ORDER|LIMIT|$)/is);
  if (!whereMatch || params.length === 0) return rows;

  const conditions = whereMatch[1].split(/\s+AND\s+/i);
  return rows.filter(row => {
    return conditions.every(cond => {
      const m = cond.match(/(\w+)\s*=\s*\$(\d+)/i);
      if (!m) return true;
      const [, col, idx] = m;
      return row[col] == params[parseInt(idx) - 1];
    });
  });
}

function generatePeriods(start, end) {
  const periods = [];
  const s = new Date(start);
  const e = new Date(end);
  let current = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), 1));

  while (current <= e) {
    const year  = current.getUTCFullYear();
    const month = current.getUTCMonth() + 1;
    const last  = new Date(Date.UTC(year, month, 0));
    periods.push({
      id:           `${year}-${String(month).padStart(2,'0')}`,
      name:         `${year}-${String(month).padStart(2,'0')}`,
      start_date:   current.toISOString().slice(0, 10),
      end_date:     last.toISOString().slice(0, 10),
      is_closed:    current < new Date(),
      fiscal_year:  year,
      fiscal_month: month,
    });
    current.setUTCMonth(current.getUTCMonth() + 1);
  }
  return periods;
}

function findRate(rates, from, to, date) {
  const rate = rates.find(r =>
    r.from_ccy === from && r.to_ccy === to && (!date || r.rate_date === date)
  );
  if (rate) return rate;

  // Try inverse
  const inverse = rates.find(r =>
    r.from_ccy === to && r.to_ccy === from && (!date || r.rate_date === date)
  );
  if (inverse) return { ...inverse, rate: 1 / inverse.rate };

  console.warn(`[kphi-sdk/harness] No rate found for ${from}→${to} on ${date}. Using 1.`);
  return { rate: 1, source: 'fallback' };
}

function validateAgainstSchema(rows, schema, calcPath) {
  const fields = schema.fields || [];
  let warnings = 0;

  for (const row of rows.slice(0, 3)) {  // Spot-check first 3 rows
    for (const field of fields) {
      if (!(field.name in row)) {
        console.warn(`[kphi-sdk/harness] Output missing declared field "${field.name}" in ${calcPath}`);
        warnings++;
      }
    }
  }

  if (warnings === 0) {
    console.log(`[kphi-sdk/harness] ✓ Output matches declared schema (${rows.length} rows)`);
  }
}

// =============================================================================
// DEFAULT MOCK DATA
// =============================================================================

const DEFAULT_ENTITIES = [
  { id: 'ent-001', name: 'Parent Co',     type: 'company',    parent_id: null,      currency: 'USD', country: 'US', is_active: true },
  { id: 'ent-002', name: 'EU Sub',        type: 'subsidiary', parent_id: 'ent-001', currency: 'EUR', country: 'DE', is_active: true },
  { id: 'ent-003', name: 'UK Branch',     type: 'branch',     parent_id: 'ent-001', currency: 'GBP', country: 'GB', is_active: true },
  { id: 'ent-004', name: 'APAC Sub',      type: 'subsidiary', parent_id: 'ent-001', currency: 'JPY', country: 'JP', is_active: true },
];

const DEFAULT_RATES = [
  { rate_date: '2025-03-31', from_ccy: 'EUR', to_ccy: 'USD', rate: 1.082, source: 'ecb' },
  { rate_date: '2025-03-31', from_ccy: 'GBP', to_ccy: 'USD', rate: 1.263, source: 'ecb' },
  { rate_date: '2025-03-31', from_ccy: 'JPY', to_ccy: 'USD', rate: 0.0066, source: 'ecb' },
  { rate_date: '2025-03-31', from_ccy: 'CHF', to_ccy: 'USD', rate: 1.114, source: 'ecb' },
  { rate_date: '2025-12-31', from_ccy: 'EUR', to_ccy: 'USD', rate: 1.095, source: 'ecb' },
  { rate_date: '2025-12-31', from_ccy: 'GBP', to_ccy: 'USD', rate: 1.271, source: 'ecb' },
  { rate_date: '2025-12-31', from_ccy: 'JPY', to_ccy: 'USD', rate: 0.0068, source: 'ecb' },
];

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  createMockCtx,
  runCalc,
  validateManifest,
  createMockSdk,
};
