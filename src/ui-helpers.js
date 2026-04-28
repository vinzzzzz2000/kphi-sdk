// =============================================================================
// K-PHI SDK — UI Helpers
// =============================================================================
// Module authors use these to register their UI into the K-Phi shell.
// The ModuleLoader calls module's index.js at startup, which calls registerView().
// The shell then renders registered views when the user selects them.
//
// This file is the BROWSER-SIDE SDK. Include it in your module's UI bundle.
// =============================================================================

'use strict';

(function (global) {

  // ---------------------------------------------------------------------------
  // INTERNAL STATE
  // ---------------------------------------------------------------------------
  const _views    = new Map();   // id → ViewRegistration
  const _widgets  = new Map();   // id → WidgetRegistration
  let   _sdk      = null;        // set when K-Phi shell calls sdk.init()

  // ---------------------------------------------------------------------------
  // REGISTRATION API — called by module authors
  // ---------------------------------------------------------------------------

  /**
   * Register a view into a K-Phi shell slot.
   *
   * The shell exposes slots:
   *   'main-panel'       — the primary content area (replaces current view)
   *   'dashboard-widget' — a card on the home dashboard
   *   'drawer'           — a slide-in panel (for detail views, settings)
   *   'modal'            — a centered overlay
   *
   * @param {object} registration
   * @param {string} registration.slot       - Target slot
   * @param {string} registration.id         - Unique view ID within this module
   * @param {string} registration.label      - Label shown in toggle / nav
   * @param {string} [registration.icon]     - Lucide icon name or emoji
   * @param {function} registration.render   - (params) => HTMLElement | string
   * @param {function} [registration.onUnmount] - cleanup when view is hidden
   *
   * @example
   * sdk.registerView({
   *   slot:  'main-panel',
   *   id:    'fx-exposures',
   *   label: 'FX Exposures',
   *   icon:  '⇄',
   *   render(params) {
   *     const el = document.createElement('div');
   *     el.innerHTML = `<h2>Exposures for ${params.currency}</h2>`;
   *     return el;
   *   }
   * });
   */
  function registerView(registration) {
    _assertField(registration, 'slot');
    _assertField(registration, 'id');
    _assertField(registration, 'label');
    _assertField(registration, 'render');

    const VALID_SLOTS = ['main-panel', 'dashboard-widget', 'drawer', 'modal'];
    if (!VALID_SLOTS.includes(registration.slot)) {
      throw new Error(
        `[kphi-sdk] Invalid slot "${registration.slot}". Valid slots: ${VALID_SLOTS.join(', ')}`
      );
    }

    if (_views.has(registration.id)) {
      console.warn(`[kphi-sdk] View "${registration.id}" already registered — overwriting`);
    }

    _views.set(registration.id, registration);

    // If shell is already initialized, register immediately
    if (_sdk) {
      _sdk._registerView(registration);
    }
  }

  /**
   * Register a dashboard widget.
   * Shorthand for registerView({ slot: 'dashboard-widget', ... })
   * with additional widget-specific config.
   *
   * @param {object} registration
   * @param {string} registration.id
   * @param {string} registration.label
   * @param {number} [registration.defaultWidth]   - Grid columns (default: 2)
   * @param {number} [registration.defaultHeight]  - Grid rows (default: 1)
   * @param {function} registration.render
   */
  function registerWidget(registration) {
    _assertField(registration, 'id');
    _assertField(registration, 'label');
    _assertField(registration, 'render');

    const widget = {
      slot:   'dashboard-widget',
      defaultWidth:  registration.defaultWidth  || 2,
      defaultHeight: registration.defaultHeight || 1,
      ...registration,
    };

    _widgets.set(registration.id, widget);

    if (_sdk) {
      _sdk._registerWidget(widget);
    }
  }

  // ---------------------------------------------------------------------------
  // SHELL COMMUNICATION — called by K-Phi shell, not by module authors
  // ---------------------------------------------------------------------------

  /**
   * Called by the K-Phi shell at startup to connect the SDK to the shell.
   * Module authors do NOT call this.
   *
   * @param {object} shellInterface
   * @param {function} shellInterface._registerView
   * @param {function} shellInterface._registerWidget
   * @param {function} shellInterface.navigate
   * @param {function} shellInterface.getParams
   * @param {function} shellInterface.onParamsChange
   */
  function _init(shellInterface) {
    _sdk = shellInterface;

    // Flush any views registered before the shell was ready
    for (const view of _views.values()) {
      _sdk._registerView(view);
    }
    for (const widget of _widgets.values()) {
      _sdk._registerWidget(widget);
    }
  }

  // ---------------------------------------------------------------------------
  // NAVIGATION HELPERS — available to module authors
  // ---------------------------------------------------------------------------

  /**
   * Navigate to a different view within the module.
   * Uses the shell's router — no page reload.
   *
   * @example
   *   sdk.navigate('fx-hedge-programs', { programId: 'prg-001' });
   */
  function navigate(viewId, params = {}) {
    if (!_sdk) {
      console.warn('[kphi-sdk] navigate() called before shell init. Queuing.');
      return;
    }
    _sdk.navigate(viewId, params);
  }

  /**
   * Get the current calc params (period, entity, scenario, currency).
   * These are controlled by the shell's global filter bar — modules read them, not set them.
   */
  function getParams() {
    if (!_sdk) return {};
    return _sdk.getParams();
  }

  /**
   * Subscribe to param changes (period selector, entity picker, etc.).
   * Returns an unsubscribe function.
   *
   * @example
   *   const unsub = sdk.onParamsChange((params) => {
   *     refreshMyView(params);
   *   });
   *   // later: unsub();
   */
  function onParamsChange(callback) {
    if (!_sdk) {
      console.warn('[kphi-sdk] onParamsChange() called before shell init');
      return () => {};
    }
    return _sdk.onParamsChange(callback);
  }

  // ---------------------------------------------------------------------------
  // DATA HELPERS — thin wrappers over the module API
  // ---------------------------------------------------------------------------

  /**
   * Fetch data from this module's API.
   * Handles auth headers and tenant scoping automatically.
   *
   * @param {string} path   - Relative path under /api/modules/{moduleId}/
   * @param {object} [opts] - fetch options
   *
   * @example
   *   const exposures = await sdk.fetch('/exposures?period=2025-Q1');
   */
  async function fetch(path, opts = {}) {
    const moduleId = _getModuleId();
    const token    = _getToken();

    const res = await global.fetch(`/api/modules/${moduleId}${path}`, {
      ...opts,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        ...(opts.headers || {}),
      },
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(`[kphi-sdk] API ${res.status}: ${body.error || res.statusText}`);
    }

    return res.json();
  }

  /**
   * Push a pre-trade order to Kyriba via K-Phi's Kyriba connector.
   * Staging: orders are queued for user approval before transmission.
   *
   * @param {object|object[]} orders - One or more pre-trade order objects
   */
  async function submitPreTradeOrders(orders) {
    return fetch('/pre-trade-orders', {
      method: 'POST',
      body:   JSON.stringify({ orders: Array.isArray(orders) ? orders : [orders] }),
    });
  }

  // ---------------------------------------------------------------------------
  // INTERNAL UTILITIES
  // ---------------------------------------------------------------------------

  function _assertField(obj, field) {
    if (!obj || !obj[field]) {
      throw new Error(`[kphi-sdk] Missing required field: "${field}"`);
    }
  }

  function _getModuleId() {
    // Module ID injected by ModuleLoader when it loads the module bundle
    return global.__KPHI_MODULE_ID__ || 'unknown-module';
  }

  function _getToken() {
    // JWT managed by K-Phi core auth — module never handles auth directly
    return global.__KPHI_AUTH_TOKEN__ || '';
  }

  // ---------------------------------------------------------------------------
  // PUBLIC API
  // ---------------------------------------------------------------------------

  const sdk = {
    // Module author API
    registerView,
    registerWidget,
    navigate,
    getParams,
    onParamsChange,
    fetch,
    submitPreTradeOrders,

    // Shell API (not for module authors)
    _init,
  };

  // Export for Node (test harness) and browser
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = sdk;
  } else {
    global.KPhiSDK = sdk;
  }

}(typeof window !== 'undefined' ? window : global));
