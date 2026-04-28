// =============================================================================
// K-PHI SDK — Context Types
// =============================================================================
// These are the types for the `ctx` object injected by CalcEngine into every
// module calculation function. Fikre (or any module author) programs against
// this interface and nothing else.
//
// Source of truth: K-phi-platform/core/calc-engine.js → buildCalcContext()
// =============================================================================

export interface KPhiContext<TInputs extends Record<string, unknown> = Record<string, unknown>> {

  // ---------------------------------------------------------------------------
  // TENANT
  // ---------------------------------------------------------------------------
  /** The authenticated tenant running this calculation. Never trust a module-passed tenantId. */
  tenantId: string;

  // ---------------------------------------------------------------------------
  // CALCULATION PARAMETERS
  // Passed by the caller (user action, schedule, or data trigger).
  // Modules must handle missing params gracefully using fallbacks.
  // ---------------------------------------------------------------------------
  params: CalcParams;

  // ---------------------------------------------------------------------------
  // INPUTS — DATA FROM UPSTREAM MODULES
  // ---------------------------------------------------------------------------
  /**
   * Resolved outputs from upstream modules declared in manifest.calculations.inputs.
   * The keys are the `name` aliases defined in the manifest, not the source calc IDs.
   *
   * Example manifest declaration:
   *   inputs:
   *     - name: liquidity_position          ← key in ctx.inputs
   *       source: liquidity-planning.net_liquidity_position
   *
   * Example usage in calculation:
   *   const lp = ctx.inputs.liquidity_position as LiquidityPositionRow[];
   *
   * IMPORTANT: Never import from another module directly. Always use ctx.inputs.
   * The CalcEngine guarantees upstream calcs have run before this function is called.
   */
  inputs: TInputs;

  // ---------------------------------------------------------------------------
  // DATABASE — SCOPED TO THIS MODULE
  // ---------------------------------------------------------------------------
  /**
   * Scoped database accessor. Automatically:
   * - Applies tenant_id to all queries
   * - Restricts table access to tables prefixed with this module's ID
   * - Logs all queries for audit
   *
   * Table naming convention: {moduleId}_{entityName}
   * e.g. kphi_fx_hedge_program, kphi_fx_exposure
   */
  db: ScopedDb;

  // ---------------------------------------------------------------------------
  // CORE — READ-ONLY ACCESS TO SHARED PLATFORM DATA
  // ---------------------------------------------------------------------------
  /**
   * Read-only accessors for core K-Phi tables shared across all modules.
   * Modules can read these but never write to them.
   */
  core: CoreAccessors;

  // ---------------------------------------------------------------------------
  // UTILITIES
  // ---------------------------------------------------------------------------
  utils: CalcUtils;
}

// =============================================================================
// CALC PARAMS
// =============================================================================
export interface CalcParams {
  periodStart?:      string;   // ISO date e.g. "2025-01-01"
  periodEnd?:        string;   // ISO date e.g. "2025-12-31"
  entityIds?:        string[] | 'all';
  scenarioId?:       string;   // 'base' | custom scenario ID
  currency?:         string;   // ISO currency code e.g. "USD", "EUR"
  [key: string]:     unknown;  // Additional params passed by the caller
}

// =============================================================================
// SCOPED DATABASE
// =============================================================================
export interface ScopedDb {
  /**
   * Execute a parameterized SQL query against this module's tables.
   * Only tables prefixed with this module's ID are accessible.
   *
   * @param sql    Parameterized SQL. Use $1, $2, ... for params.
   * @param params Query parameters array.
   *
   * @example
   *   const hedges = await ctx.db.query(
   *     'SELECT * FROM kphi_fx_hedge_program WHERE entity_id = $1',
   *     [entityId]
   *   );
   */
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
}

// =============================================================================
// CORE ACCESSORS
// =============================================================================
export interface CoreAccessors {
  /**
   * Entity hierarchy — companies, subsidiaries, funds, etc.
   * Use this to understand the reporting structure.
   */
  getEntityHierarchy(): Promise<EntityHierarchyRow[]>;

  /**
   * Exchange rates for a given date.
   * Returns rates vs. the tenant's reporting currency.
   */
  getExchangeRates(date: string): Promise<ExchangeRateRow[]>;

  /**
   * All configured reporting periods for this tenant.
   */
  getPeriods(): Promise<PeriodRow[]>;

  /**
   * Translates an amount from one currency to another on a given date.
   * Uses the platform's central rate store — consistent across all modules.
   *
   * @example
   *   const result = await ctx.core.translateCurrency(1000000, 'EUR', 'USD', '2025-03-31');
   *   // result.amount = 1082000, result.rate = 1.082, result.source = 'ecb'
   */
  translateCurrency(
    amount: number,
    from:   string,
    to:     string,
    date:   string
  ): Promise<CurrencyTranslationResult>;
}

// =============================================================================
// CORE DATA ROW TYPES
// =============================================================================
export interface EntityHierarchyRow {
  id:           string;
  name:         string;
  type:         'company' | 'subsidiary' | 'branch' | 'fund' | 'spv' | string;
  parent_id:    string | null;
  currency:     string;
  country:      string;
  is_active:    boolean;
}

export interface ExchangeRateRow {
  rate_date:   string;
  from_ccy:    string;
  to_ccy:      string;
  rate:        number;
  source:      string;   // 'ecb' | 'kyriba' | 'manual'
}

export interface PeriodRow {
  id:           string;
  name:         string;
  start_date:   string;
  end_date:     string;
  is_closed:    boolean;
  fiscal_year:  number;
  fiscal_month: number;
}

export interface CurrencyTranslationResult {
  amount: number;
  rate:   number;
  source: string;
}

// =============================================================================
// UTILITIES
// =============================================================================
export interface CalcUtils {
  /** Roll forward a base dataset across periods using growth rates or patterns. */
  rollForward(baseData: unknown[], periods: PeriodRow[]): unknown[];

  /** Interpolate missing values using 'linear' | 'flat' | 'seasonal' methods. */
  interpolate(data: unknown[], method: 'linear' | 'flat' | 'seasonal'): unknown[];

  /** Group and aggregate rows — equivalent to SQL GROUP BY + SUM. */
  aggregate<T>(
    data:      T[],
    groupBy:   (keyof T)[],
    sumFields: (keyof T)[]
  ): T[];
}

// =============================================================================
// CALCULATION FUNCTION SIGNATURE
// =============================================================================
/**
 * Every calculation function in a K-Phi module must match this signature.
 *
 * @example
 * // kphi-fx/calculations/exposure-matrix.js
 * module.exports = async function exposureMatrix(ctx) {
 *   const glRows  = ctx.inputs.gl_by_currency;   // declared in manifest inputs
 *   const hedges  = ctx.inputs.existing_hedges;  // declared in manifest inputs
 *   const entities = await ctx.core.getEntityHierarchy();
 *
 *   const results = [];
 *   // ... your FX logic ...
 *   return results; // must return array matching declared output schema
 * };
 */
export type CalcFunction<
  TInputs  extends Record<string, unknown> = Record<string, unknown>,
  TOutput  extends Record<string, unknown> = Record<string, unknown>
> = (ctx: KPhiContext<TInputs>) => Promise<TOutput[]>;

// =============================================================================
// UI SLOT REGISTRATION (ui-helpers contract)
// =============================================================================
export interface ViewRegistration {
  /** Must match one of the slot values declared in your manifest.ui.slot */
  slot:      'main-panel' | 'dashboard-widget' | 'drawer' | 'modal';

  /** Unique view ID within this module */
  id:        string;

  /** Label shown in the toggle bar or nav */
  label:     string;

  /** Optional icon (Lucide name or emoji) */
  icon?:     string;

  /** The render function — receives the current ctx params, returns HTML string or DOM element */
  render:    (params: CalcParams) => HTMLElement | string;

  /** Optional cleanup called when the view is unmounted */
  onUnmount?: () => void;
}

// =============================================================================
// TEST HARNESS TYPES (used in local development)
// =============================================================================
export interface MockContextOptions<TInputs extends Record<string, unknown>> {
  tenantId?:  string;
  params?:    Partial<CalcParams>;
  inputs?:    TInputs;
  mockData?:  Record<string, unknown[]>;  // table name → rows for ctx.db.query mock
}
