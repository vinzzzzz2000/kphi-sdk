# @kphi/sdk

The K-Phi module development kit. Everything you need to build, test, and integrate a module into the K-Phi platform — without access to K-Phi core source.

---

## Install

```bash
npm install @kphi/sdk
```

---

## What's in the box

| File | What it does |
|---|---|
| `schema/manifest-schema.json` | Validates your `manifest.yaml`. If it passes, it loads. |
| `types/index.d.ts` | TypeScript types for `ctx` — the object injected into every calculation. |
| `src/test-harness.js` | Run and test your calculations locally. No K-Phi instance needed. |
| `src/ui-helpers.js` | Register your UI views into the K-Phi shell (toggle, main panel, widgets). |
| `design/tokens.css` | K-Phi design tokens — colors, fonts, spacing. Import this so your module matches the platform visually. |
| `design/shell.html` | Dev shell template — renders your module inside a K-Phi shell mockup. |
| `scripts/dev.js` | Local dev server. Run `npx kphi-dev` to preview your module in the K-Phi shell. |

---

## Quick start

### 1. Validate your manifest

```bash
node -e "require('@kphi/sdk').validateManifest('./manifest.yaml')"
```

### 2. Write a calculation

```js
// calculations/exposure-matrix.js
module.exports = async function exposureMatrix(ctx) {
  // Upstream data injected by CalcEngine (declared in manifest inputs)
  const liquidityCF = ctx.inputs.liquidity_cf;

  // Your module's own data
  const hedges = await ctx.db.query(
    'SELECT * FROM kphi_fx_hedge_program WHERE entity_id = $1',
    [ctx.params.entityIds[0]]
  );

  // Core platform data
  const entities = await ctx.core.getEntityHierarchy();
  const rate = await ctx.core.translateCurrency(1000000, 'EUR', 'USD', ctx.params.periodEnd);

  // Return rows matching your manifest output schema
  return entities.map(entity => ({
    period:        ctx.params.periodStart,
    entity_id:     entity.id,
    currency:      'EUR',
    gross_exposure: 1000000,
    hedge_ratio:    0.75,
    net_exposure:   250000,
  }));
};
```

### 3. Test it locally

```js
// test/exposure-matrix.test.js
const { createMockCtx, runCalc } = require('@kphi/sdk');

const ctx = createMockCtx({
  params: { periodStart: '2025-01-01', periodEnd: '2025-12-31', currency: 'USD' },
  inputs: {
    liquidity_cf: require('./fixtures/liquidity-cf.json'),
  },
  mockData: {
    'kphi_fx_hedge_program': require('./fixtures/hedge-programs.json'),
  }
});

runCalc('./calculations/exposure-matrix.js', ctx).then(result => {
  console.log(result);
});
```

### 4. Register your UI

```js
// index.js (browser bundle entry point)
const sdk = window.KPhiSDK;

sdk.registerView({
  slot:  'main-panel',
  id:    'fx-exposures',
  label: 'FX',           // shown in the toggle bar
  icon:  '⇄',
  render(params) {
    // params = { periodStart, periodEnd, currency, entityIds, ... }
    const el = document.createElement('div');
    sdk.fetch(`/exposures?period=${params.periodStart}`)
      .then(data => { el.innerHTML = renderTable(data); });
    return el;
  },
  onUnmount() {
    // cleanup event listeners, timers, etc.
  }
});
```

### 4. Preview in the K-Phi shell

```bash
npx kphi-dev
```

Opens `http://localhost:3333` — your module rendered inside the K-Phi shell with the exact same colors, fonts, sidebar, topbar, and toggle bar your users see. No K-Phi instance needed.

If you haven't built a UI yet, the dev shell shows a **component preview** with all available K-Phi styled elements (buttons, tables, cards, badges, stat blocks, financial rows) so you can see the design system and copy the CSS classes.

### 5. Use design tokens in your UI

```js
// Your module's render function
render(params) {
  const el = document.createElement('div');
  el.innerHTML = `
    <div class="kphi-card">
      <div class="kphi-card-header">FX Exposures</div>
      <div class="kphi-card-body">
        <table class="kphi-table">
          <thead><tr><th>Entity</th><th>CCY</th><th>Net Exposure</th></tr></thead>
          <tbody>
            <tr><td>US-HQ</td><td>EUR</td><td class="kphi-negative">-350,000</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  `;
  return el;
}
```

Available CSS classes: `kphi-card`, `kphi-table`, `kphi-btn`, `kphi-btn-primary`, `kphi-badge`, `kphi-chip`, `kphi-input`, `kphi-select`, `kphi-hero`, `kphi-section`, `kphi-row`, `kphi-stat-value`, `kphi-positive`, `kphi-negative`, `kphi-mono`, `kphi-code`. See `design/tokens.css` for the full list.

---

## The contract

Your module receives a `ctx` object. This is the only interface between your module and K-Phi core.

```
ctx.tenantId          — who is running this
ctx.params            — period, entity, scenario, currency
ctx.inputs            — data from upstream modules (declared in manifest)
ctx.db.query()        — your module's tables only
ctx.core.*            — read-only access to shared platform data
ctx.utils.*           — calculation helpers
```

**Never import from another K-Phi module directly.** Declare the dependency in your manifest and read it from `ctx.inputs`. The CalcEngine guarantees execution order.

---

## Manifest reference

See `schema/manifest-schema.json` for the full schema. Key sections:

```yaml
id: kphi-fx               # must match directory name
name: FX Management
version: 1.0.0
category: fx

calculations:
  inputs:
    - name: liquidity_cf               # key in ctx.inputs
      source: liquidity-planning.net_liquidity_position
      required: true

  outputs:
    - name: exposure_matrix
      calculation: ./calculations/exposure-matrix.js
      cacheTTL: 5m
      schema:
        fields:
          - { name: period,        type: date }
          - { name: entity_id,     type: string }
          - { name: net_exposure,  type: decimal }

ui:
  slot: main-panel
  toggleLabel: FX
```

---

## IP note

This SDK defines the interface. Your module implementation is yours.
