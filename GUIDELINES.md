# K-Φ Module Development Guidelines

> "A treasury professional should go from raw data to actionable insight in a single session.  
> Your module is the bridge. Don't make them wait."

---

## 1. Why K-Phi Exists

Treasury teams in mid-market companies are underserved. Enterprise TMS platforms (Kyriba, ION, FIS) are powerful but closed. Spreadsheets are flexible but fragile. There is nothing in between that is intelligent, modular, and fast to deploy.

K-Phi fills that gap. It is not a TMS replacement. It is a **treasury intelligence layer** — it connects to the systems of record, classifies the data, and surfaces decisions.

Every module you build should answer the same question the CFO or treasurer asks on Monday morning. Not next week. Monday morning.

---

## 2. The One-Day Rule

**A new user must reach a meaningful output within one business day of connecting their data.**

This is not a soft goal. It is the primary design constraint.

What this means in practice:

- Your module's happy path must work with a CSV import, not just a live API. Not every tenant has Kyriba connected on day one.
- Default configurations should work out of the box. Ask for configuration only when the default is wrong.
- The first screen a user sees after activation must show data, not a setup wizard.
- If your module requires more than one data source to produce any output, reconsider the scope.

What this does not mean:

- It does not mean cutting corners on correctness. A wrong number fast is worse than no number.
- It does not mean skipping edge cases. Handle missing data gracefully — show partial results with a clear indicator rather than blocking on completeness.

---

## 3. Module Design Principles

### Own your domain. Nothing else.

Your module is the expert on its domain. `kphi-fx` knows everything about FX exposure, hedging programs, and pre-trade orders. It knows nothing about how tenants are billed, how users are authenticated, or how the liquidity forecast is computed.

If you find yourself querying a table that belongs to another module, stop. Declare an input dependency in your manifest and read it from `ctx.inputs`.

```yaml
# correct
calculations:
  inputs:
    - name: liquidity_cf
      source: liquidity-planning.net_liquidity_position
      required: true

# never do this
# const lp = require('../liquidity-planning/calculations/net-liquidity-position');
```

### Declare, don't import

The CalcEngine resolves dependencies and injects data. This is not a convention — it is the architecture. Direct imports between modules break tenant isolation, make the dependency graph invisible, and create circular dependency risks that crash the platform at startup.

If you need data from another module, declare it. If that module does not exist yet, use a fallback.

### Small surface area

A module should do one thing well. Resist the urge to add a second domain because it is related. `kphi-fx` handles FX. Debt management is a different module. Interest rate risk is a different module.

Small modules are:
- Easier to license selectively
- Easier to maintain independently
- Easier to replace if a better implementation exists
- Cleaner in terms of IP ownership

### Handle missing data, don't block on it

Treasury data is always incomplete. Bank feeds are delayed. Forecasts have gaps. ERP exports have unmapped accounts.

Your module must degrade gracefully:
- Show what you can compute with available data
- Flag what is missing and why
- Never show an empty screen when partial results are possible

```js
// good — show partial results
return entities.map(entity => {
  const hedges = hedgesByEntity[entity.id] || [];
  return {
    entity_id:    entity.id,
    net_exposure: computeExposure(glRows, entity),
    hedge_ratio:  hedges.length > 0 ? computeRatio(hedges) : null,  // null = no hedges yet
    data_quality: hedges.length > 0 ? 'complete' : 'unhedged_only',
  };
});

// bad — block entirely
if (!hedges.length) throw new Error('No hedge data available');
```

---

## 4. The Kyriba Relationship

Kyriba is a **data source and execution target**, not a competitor.

When integrating with Kyriba:

- **Pull** (existing hedges, positions, bank balances) — always offer a file import fallback. Not every tenant has API access enabled.
- **Push** (pre-trade orders, payment instructions) — always stage for user approval before transmission. Never push to Kyriba without an explicit user action.
- Never replicate Kyriba's core functionality. If Kyriba already does it well, connect to it. Build what Kyriba does not.

The integration point is `sdk.submitPreTradeOrders()`. Use it. Do not build a parallel Kyriba connector.

---

## 5. Technology Constraints

### No framework dependencies in calculations

Calculation functions (`ctx` → rows) are pure Node.js. No React, no Vue, no external HTTP calls, no file system access. They receive data through `ctx` and return rows. That is the entire contract.

Dependencies that bloat the calculation layer slow down every tenant on every run. If you need a financial math library, keep it small and declare it in your `package.json`. If you need market data, fetch it in an ingestion step and store it in your module's tables — not inline in a calculation.

### Keep the UI layer honest

The K-Phi frontend is deliberately simple. No build pipeline, no transpilation, no webpack. Your UI fragment must work in the same environment.

- Use vanilla JS or a minimal library that ships as a single file
- Do not introduce a build step that only you can run
- CSS must be scoped to your module's DOM — no global style pollution
- If you need a chart, use the same charting approach already in the shell

### SQLite is the database

One SQLite file per tenant. This means:

- No JSON columns with deeply nested structures — normalize it
- No full-text search assumptions
- Batch inserts for large datasets (>1000 rows at a time)
- Your table names are prefixed automatically (`kphi_fx_*`) — do not prefix them yourself

---

## 6. Definition of Done

A module is not done when the code works. It is done when a treasury professional can use it without reading documentation.

Before submitting a module for integration:

**Functional**
- [ ] Manifest validates: `node -e "require('@kphi/sdk').validateManifest('./manifest.yaml')"`
- [ ] All calculation outputs return arrays matching the declared schema
- [ ] Module works with CSV import (no live API required for happy path)
- [ ] Partial data produces partial results, not errors
- [ ] Lifecycle hooks implemented: `onRegister` creates tables, `onUnregister` cleans up

**Integration**
- [ ] `ctx.inputs` used for all cross-module data — no direct imports
- [ ] Cache TTLs declared on all outputs
- [ ] Triggers declared so downstream modules invalidate correctly
- [ ] Kyriba push operations go through `sdk.submitPreTradeOrders()` with user approval gate

**UI**
- [ ] `toggleLabel` is set and under 12 characters
- [ ] First screen shows data on activation — no empty states for a tenant with data
- [ ] Module works in the shell toggle without page reload
- [ ] No global CSS pollution

**Quality**
- [ ] Test harness covers the happy path and at least two edge cases (missing data, zero values)
- [ ] Calculation functions are deterministic — same inputs, same outputs, every time
- [ ] No `console.log` left in production paths

---

## 7. What Good Looks Like

A well-built K-Phi module feels like it was built by the domain expert, not by a developer who read about the domain.

For `kphi-fx` specifically, that means:
- The exposure matrix speaks the language of a treasury analyst — transaction vs. translation vs. economic, not "category A vs. B vs. C"
- The hedging program view matches how a treasurer actually thinks about programs — by instrument, by tenor, by entity, not by database ID
- The pre-trade order flow mirrors what they would do in Kyriba manually, so approval is a confirmation not a translation exercise

When in doubt, ask: **would a treasurer trust this number on a Monday morning call?** If the answer requires explanation, the module is not done.

---

## 8. Repo and IP

Each module lives in its own repository. This is intentional.

- Your repo, your IP
- Your entity contracts with the K-Phi Kft for integration and revenue share
- The SDK defines the interface — what you build behind it is yours
- The K-Phi core never has visibility into your implementation, only your declared inputs and outputs

Keep your repo private until the integration agreement is signed. Work on a personal machine, personal GitHub account, outside employer hours, with no employer data or proprietary methodology. The domain expertise in your head is yours. Document that the work was done independently.

---

*K-Φ SDK · guidelines v1.0*
