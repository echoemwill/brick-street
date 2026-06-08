/* ────────────────────────────────────────────────────────────
   Brick Street — Trading & Investment Journal
   - Logged out  → entries saved in localStorage (unlimited, device-only)
   - Logged in   → entries synced to the account (analytics + CSV export)
   On login, any local entries are pushed up to the account once.
   ──────────────────────────────────────────────────────────── */
(function () {
  const LS_KEY = 'bs_journal_entries';

  const state = {
    type: 'trade', entries: [], formOpen: false, editingId: null,
    user: null,                      // {id,name,email,plan} when logged in
    cal: null,                       // {year, month} when the calendar overlay is open
  };
  const priceCache = {};            // symbol → {price, company} | null

  // ── tiny helpers ──────────────────────────────────────────
  const $  = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const token  = () => localStorage.getItem('bs_token');
  const authed = () => !!token();
  // Pro ($5/mo) subscription gate — the P&L calendar is a pro-only feature.
  const isPro  = () => !!(state.user && state.user.plan === 'pro');
  const uuid   = () => (crypto.randomUUID ? crypto.randomUUID()
    : 'id-' + Date.now() + '-' + Math.random().toString(16).slice(2));
  const num = v => (v === '' || v == null || isNaN(+v)) ? null : +v;
  const today = () => new Date().toISOString().slice(0, 10);

  const money = v => v == null ? '—'
    : (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pct = v => v == null ? '—' : (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
  const rfmt = v => v == null ? '—' : (v >= 0 ? '+' : '') + v.toFixed(2) + 'R';

  // Compact money for the big calendar squares: no cents, sign, grouped (e.g. -$200, +$1,250).
  const moneyShort = v => v == null ? ''
    : (v < 0 ? '-$' : '+$') + Math.round(Math.abs(v)).toLocaleString('en-US');

  // The day a trade's P&L belongs to: its close date (realised), else its open date.
  const tradeDay = e => (e.closedAt || e.openedAt || (e.createdAt || '').slice(0, 10) || '');

  // ── API ───────────────────────────────────────────────────
  async function api(path, opts = {}) {
    const headers = { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true' };
    if (token()) headers.Authorization = 'Bearer ' + token();
    const res = await fetch(path, { ...opts, headers: { ...headers, ...(opts.headers || {}) } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  const entryToServer = e => { const { id, type, ...rest } = e; return { client_id: id, type, data: rest }; };
  const serverToEntry = s => ({ id: s.client_id, type: s.type, ...s.data });

  // ── storage ───────────────────────────────────────────────
  function localGet() {
    try { return JSON.parse(localStorage.getItem(LS_KEY)) || []; } catch { return []; }
  }
  function localSet(arr) { localStorage.setItem(LS_KEY, JSON.stringify(arr)); }

  async function loadEntries() {
    if (authed()) {
      try {
        const r = await api('/api/journal');
        state.entries = (r.entries || []).map(serverToEntry);
        return;
      } catch (_) { /* fall through to local */ }
    }
    state.entries = localGet();
  }

  async function saveEntry(e) {
    if (authed()) {
      const r = await api('/api/journal', { method: 'POST', body: JSON.stringify(entryToServer(e)) });
      state.entries = (r.entries || []).map(serverToEntry);
    } else {
      const i = state.entries.findIndex(x => x.id === e.id);
      if (i >= 0) state.entries[i] = e; else state.entries.unshift(e);
      localSet(state.entries);
    }
  }

  async function deleteEntry(id) {
    state.entries = state.entries.filter(x => x.id !== id);
    if (authed()) { try { await api('/api/journal/' + id, { method: 'DELETE' }); } catch (_) {} }
    else localSet(state.entries);
  }

  // ── quotes (auto-fill + investment returns) ───────────────
  async function fetchQuote(sym) {
    sym = (sym || '').toUpperCase();
    if (!sym) return null;
    if (priceCache[sym] !== undefined) return priceCache[sym];
    try {
      const r = await api('/api/quote/' + encodeURIComponent(sym));
      priceCache[sym] = { price: r.current_price ?? null, company: r.company_name || sym };
    } catch (_) { priceCache[sym] = null; }
    return priceCache[sym];
  }

  // ── computed metrics ──────────────────────────────────────
  function computeTrade(d) {
    const entry = num(d.entry), exit = num(d.exit), size = num(d.size) || 0;
    const fees = num(d.fees) || 0, stop = num(d.stop);
    const closed = exit != null;
    let pnl = null, pnlPct = null, r = null;
    if (closed && entry != null && size) {
      pnl = (d.direction === 'short' ? (entry - exit) : (exit - entry)) * size - fees;
      if (entry) pnlPct = (pnl / (entry * size)) * 100;
      if (stop != null && stop !== entry) {
        const risk = Math.abs(entry - stop) * size;
        if (risk > 0) r = pnl / risk;
      }
    }
    let days = null;
    if (d.openedAt && d.closedAt) {
      days = Math.max(0, Math.round((new Date(d.closedAt) - new Date(d.openedAt)) / 86400000));
    }
    return { closed, pnl, pnlPct, r, days };
  }

  function computeInvestment(d) {
    const price = num(d.price), size = num(d.size) || 0;
    const cost = price != null ? price * size : null;
    const cur = (priceCache[(d.symbol || '').toUpperCase()] || {}).price;
    let ret = null, value = null;
    if (cur != null && price) { ret = ((cur - price) / price) * 100; value = cur * size; }
    return { cost, ret, value, current: cur ?? null };
  }

  // ── rendering ─────────────────────────────────────────────
  function render() {
    renderBanner();
    renderAnalytics();
    renderList();
    // Export always presents as available — for subscription accounts, Emil, and
    // regular accounts alike (guests clicking it are nudged to register).
    const exp = $('jrExportBtn');
    if (exp) exp.classList.remove('jr-locked');
  }

  function renderBanner() {
    const el = $('jrTierBanner');
    if (!el) return;
    if (authed()) {
      el.innerHTML = `<span class="jr-badge jr-badge--ok">● Synced to your account</span>`;
    } else {
      el.innerHTML = `
        <div class="jr-free-note">
          <strong>Free journal</strong> — entries are saved on this device only.
          <button class="jr-link" id="jrSigninHint">Create an account</button>
          to sync across devices and unlock analytics &amp; CSV export.
        </div>`;
      const hint = $('jrSigninHint');
      if (hint) hint.onclick = () => { const b = $('openRegisterBtn') || $('openLoginBtn'); if (b) b.click(); };
    }
  }

  function renderAnalytics() {
    const el = $('jrAnalytics');
    if (!el) return;

    if (!authed()) {
      el.innerHTML = `
        <div class="jr-locked-card">
          <div class="jr-locked-icon">🔒</div>
          <div>
            <div class="jr-locked-title">Analytics are an account feature</div>
            <div class="jr-locked-sub">Win rate, profit factor, average R and more — sign in to unlock.</div>
          </div>
        </div>`;
      return;
    }

    const items = state.entries.filter(e => e.type === state.type);
    if (!items.length) { el.innerHTML = ''; return; }

    if (state.type === 'trade') {
      const closed = items.map(computeTrade).filter(c => c.closed && c.pnl != null);
      if (!closed.length) { el.innerHTML = `<div class="jr-stats-row"><div class="jr-stat"><span class="jr-stat-v">${items.length}</span><span class="jr-stat-l">Logged</span></div><div class="jr-stat"><span class="jr-stat-v">${items.length - closed.length}</span><span class="jr-stat-l">Open</span></div></div>`; return; }
      const wins = closed.filter(c => c.pnl > 0);
      const losses = closed.filter(c => c.pnl < 0);
      const totalPnl = closed.reduce((s, c) => s + c.pnl, 0);
      const gp = wins.reduce((s, c) => s + c.pnl, 0);
      const gl = Math.abs(losses.reduce((s, c) => s + c.pnl, 0));
      const pf = gl ? gp / gl : (gp ? Infinity : 0);
      const avgWin = wins.length ? gp / wins.length : 0;
      const avgLoss = losses.length ? gl / losses.length : 0;
      const rs = closed.map(c => c.r).filter(r => r != null);
      const avgR = rs.length ? rs.reduce((s, r) => s + r, 0) / rs.length : null;
      const winRate = Math.round((wins.length / closed.length) * 100);
      el.innerHTML = `
        <div class="jr-stats-row">
          ${stat(money(totalPnl), 'Net P&L', totalPnl >= 0 ? 'pos' : 'neg')}
          ${stat(winRate + '%', 'Win rate')}
          ${stat(closed.length, 'Closed')}
          ${stat(pf === Infinity ? '∞' : pf.toFixed(2), 'Profit factor')}
          ${stat(avgR == null ? '—' : rfmt(avgR), 'Avg R')}
          ${stat(money(avgWin), 'Avg win', 'pos')}
          ${stat(money(-avgLoss), 'Avg loss', 'neg')}
        </div>`;
    } else {
      const comps = items.map(computeInvestment);
      const cost = comps.reduce((s, c) => s + (c.cost || 0), 0);
      const valued = comps.filter(c => c.value != null);
      const value = valued.reduce((s, c) => s + c.value, 0);
      const investedValued = items.filter((_, i) => comps[i].value != null)
        .reduce((s, e) => s + ((num(e.price) || 0) * (num(e.size) || 0)), 0);
      const ret = investedValued ? ((value - investedValued) / investedValued) * 100 : null;
      el.innerHTML = `
        <div class="jr-stats-row">
          ${stat(items.length, 'Positions')}
          ${stat(money(cost), 'Total invested')}
          ${stat(valued.length ? money(value) : '—', 'Current value')}
          ${stat(ret == null ? '—' : pct(ret), 'Unrealised', ret == null ? '' : ret >= 0 ? 'pos' : 'neg')}
        </div>`;
    }
  }

  const stat = (v, l, cls = '') =>
    `<div class="jr-stat"><span class="jr-stat-v ${cls}">${v}</span><span class="jr-stat-l">${l}</span></div>`;

  function renderList() {
    const el = $('jrList');
    if (!el) return;
    const items = state.entries.filter(e => e.type === state.type);

    if (!items.length) {
      el.innerHTML = `
        <div class="jr-empty">
          <div class="jr-empty-icon">
            ${state.type === 'trade'
              ? `<svg viewBox="0 0 48 48" fill="none" width="44" height="44">
                   <rect x="7"  y="22" width="9"  height="18" rx="2" fill="currentColor" opacity="0.18"/>
                   <rect x="20" y="14" width="9"  height="26" rx="2" fill="currentColor" opacity="0.18"/>
                   <rect x="33" y="8"  width="9"  height="32" rx="2" fill="currentColor" opacity="0.18"/>
                   <line x1="11.5" y1="8"  x2="11.5" y2="22" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
                   <line x1="11.5" y1="40" x2="11.5" y2="44" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
                   <line x1="24.5" y1="4"  x2="24.5" y2="14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
                   <line x1="24.5" y1="40" x2="24.5" y2="44" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
                   <line x1="37.5" y1="2"  x2="37.5" y2="8"  stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
                   <line x1="37.5" y1="40" x2="37.5" y2="44" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
                   <polyline points="6,36 14,26 22,30 36,18 44,22" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" opacity="0.7"/>
                 </svg>`
              : `<svg viewBox="0 0 48 48" fill="none" width="44" height="44">
                   <rect x="4"  y="28" width="10" height="16" rx="1.5" fill="currentColor" opacity="0.18"/>
                   <rect x="17" y="20" width="14" height="24" rx="1.5" fill="currentColor" opacity="0.18"/>
                   <rect x="34" y="12" width="10" height="32" rx="1.5" fill="currentColor" opacity="0.18"/>
                   <line x1="4" y1="44" x2="44" y2="44" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
                   <polyline points="7,27 11,22 20,17 27,19 38,11" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" opacity="0.7"/>
                   <circle cx="38" cy="11" r="2.5" fill="currentColor" opacity="0.7"/>
                 </svg>`}
          </div>
          <div class="jr-empty-title">No ${state.type === 'trade' ? 'trades' : 'positions'} yet</div>
          <div class="jr-empty-sub">Hit <strong>+ New entry</strong> to log your first one.</div>
        </div>`;
      return;
    }

    el.innerHTML = items.map(e => state.type === 'trade' ? tradeCard(e) : investCard(e)).join('');
    el.querySelectorAll('[data-edit]').forEach(b =>
      b.onclick = () => openForm(state.type, state.entries.find(x => x.id === b.dataset.edit)));
    el.querySelectorAll('[data-del]').forEach(b =>
      b.onclick = async () => {
        if (!confirm('Delete this entry?')) return;
        await deleteEntry(b.dataset.del); render();
      });

    if (state.type === 'investment') ensureInvestmentPrices(items);
  }

  function tradeCard(e) {
    const c = computeTrade(e);
    const dirCls = e.direction === 'short' ? 'short' : 'long';
    const statusCls = c.closed ? 'closed' : 'open';
    const pnlCls = c.pnl == null ? '' : c.pnl >= 0 ? 'pos' : 'neg';
    return `
      <div class="jr-card jr-card--${dirCls}" data-card="${e.id}" data-day="${tradeDay(e)}">
        <div class="jr-card-main">
          <div class="jr-card-head">
            <span class="jr-sym">${esc(e.symbol)}</span>
            <span class="jr-tag jr-tag--${dirCls}">${e.direction === 'short' ? 'SHORT' : 'LONG'}</span>
            <span class="jr-tag jr-tag--${statusCls}">${c.closed ? 'CLOSED' : 'OPEN'}</span>
            ${e.setup ? `<span class="jr-tag jr-tag--setup">${esc(e.setup)}</span>` : ''}
          </div>
          <div class="jr-card-row">
            <span>Entry <strong>${money(num(e.entry))}</strong></span>
            ${c.closed ? `<span>Exit <strong>${money(num(e.exit))}</strong></span>` : ''}
            <span>Size <strong>${esc(e.size || '—')}</strong></span>
            ${e.stop ? `<span>Stop <strong>${money(num(e.stop))}</strong></span>` : ''}
            ${c.days != null ? `<span>${c.days}d held</span>` : ''}
          </div>
          ${e.notes ? `<div class="jr-card-notes">${esc(e.notes)}</div>` : ''}
        </div>
        <div class="jr-card-side">
          <div class="jr-pnl ${pnlCls}">${c.pnl == null ? 'OPEN' : money(c.pnl)}</div>
          <div class="jr-sub-metrics">
            <span class="${pnlCls}">${pct(c.pnlPct)}</span>
            <span class="${c.r == null ? '' : c.r >= 0 ? 'pos' : 'neg'}">${rfmt(c.r)}</span>
          </div>
          <div class="jr-card-actions">
            <button class="jr-mini" data-edit="${e.id}">Edit</button>
            <button class="jr-mini jr-mini--del" data-del="${e.id}">✕</button>
          </div>
        </div>
      </div>`;
  }

  function investCard(e) {
    const c = computeInvestment(e);
    const retCls = c.ret == null ? '' : c.ret >= 0 ? 'pos' : 'neg';
    const action = (e.action || 'buy').toUpperCase();
    const conv = '★'.repeat(num(e.conviction) || 0) + '☆'.repeat(5 - (num(e.conviction) || 0));
    return `
      <div class="jr-card jr-card--invest">
        <div class="jr-card-main">
          <div class="jr-card-head">
            <span class="jr-sym">${esc(e.symbol)}</span>
            <span class="jr-tag jr-tag--action">${esc(action)}</span>
            ${e.horizon ? `<span class="jr-tag jr-tag--setup">${esc(e.horizon)}</span>` : ''}
            <span class="jr-conv" title="Conviction">${conv}</span>
          </div>
          <div class="jr-card-row">
            <span>Price <strong>${money(num(e.price))}</strong></span>
            <span>Size <strong>${esc(e.size || '—')}</strong></span>
            <span>Cost <strong>${money(c.cost)}</strong></span>
            ${e.targetAllocation ? `<span>Target <strong>${esc(e.targetAllocation)}%</strong></span>` : ''}
          </div>
          ${e.thesis ? `<div class="jr-card-notes"><span class="jr-notes-label">Thesis:</span> ${esc(e.thesis)}</div>` : ''}
          ${e.reviewNotes ? `<div class="jr-card-notes"><span class="jr-notes-label">Review:</span> ${esc(e.reviewNotes)}</div>` : ''}
        </div>
        <div class="jr-card-side">
          <div class="jr-pnl ${retCls}">${c.ret == null ? '—' : pct(c.ret)}</div>
          <div class="jr-sub-metrics"><span>${c.value == null ? 'now —' : 'now ' + money(c.current)}</span></div>
          <div class="jr-card-actions">
            <button class="jr-mini" data-edit="${e.id}">Edit</button>
            <button class="jr-mini jr-mini--del" data-del="${e.id}">✕</button>
          </div>
        </div>
      </div>`;
  }

  let _pricesFetching = false;
  async function ensureInvestmentPrices(items) {
    if (_pricesFetching) return;
    const syms = [...new Set(items.map(e => (e.symbol || '').toUpperCase()).filter(Boolean))]
      .filter(s => priceCache[s] === undefined);
    if (!syms.length) return;
    _pricesFetching = true;
    await Promise.all(syms.map(fetchQuote));
    _pricesFetching = false;
    if (state.type === 'investment') { renderAnalytics(); renderList(); }
  }

  // ── entry form ────────────────────────────────────────────
  function openForm(type, prefill) {
    state.formOpen = true;
    state.editingId = prefill && prefill.id ? prefill.id : null;
    const wrap = $('jrFormWrap');
    wrap.innerHTML = type === 'trade' ? tradeForm(prefill || {}) : investForm(prefill || {});
    wireForm(type);
    wrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  function closeForm() { state.formOpen = false; state.editingId = null; $('jrFormWrap').innerHTML = ''; }

  const field = (label, inner) => `<label class="jr-field"><span class="jr-flabel">${label}</span>${inner}</label>`;
  const inp = (id, attrs = '') => `<input class="jr-input" id="${id}" ${attrs} autocomplete="off" />`;

  function tradeForm(d) {
    return `
      <form class="jr-form" id="jrForm">
        <div class="jr-form-title">${d.id ? 'Edit trade' : 'New trade'}</div>
        <div class="jr-grid">
          ${field('Symbol', `<div class="jr-sym-wrap">${inp('jf-symbol', `value="${esc(d.symbol || '')}" maxlength="10" placeholder="NVDA"`)}<span class="jr-sym-hint" id="jf-hint"></span></div>`)}
          ${field('Direction', `<div class="jr-seg" id="jf-dir">
            <button type="button" class="jr-seg-btn ${d.direction !== 'short' ? 'active' : ''}" data-dir="long">Long</button>
            <button type="button" class="jr-seg-btn ${d.direction === 'short' ? 'active' : ''}" data-dir="short">Short</button>
          </div><input type="hidden" id="jf-direction" value="${d.direction === 'short' ? 'short' : 'long'}" />`)}
          ${field('Entry price', inp('jf-entry', `type="number" step="any" value="${d.entry ?? ''}" placeholder="0.00"`))}
          ${field('Exit price <span class="jr-opt">(blank = open)</span>', inp('jf-exit', `type="number" step="any" value="${d.exit ?? ''}" placeholder="0.00"`))}
          ${field('Size (shares)', inp('jf-size', `type="number" step="any" value="${d.size ?? ''}" placeholder="0"`))}
          ${field('Fees <span class="jr-opt">(opt)</span>', inp('jf-fees', `type="number" step="any" value="${d.fees ?? ''}" placeholder="0"`))}
          ${field('Stop <span class="jr-opt">(for R)</span>', inp('jf-stop', `type="number" step="any" value="${d.stop ?? ''}" placeholder="0.00"`))}
          ${field('Target <span class="jr-opt">(opt)</span>', inp('jf-target', `type="number" step="any" value="${d.target ?? ''}" placeholder="0.00"`))}
          ${field('Opened', inp('jf-openedAt', `type="date" value="${d.openedAt || today()}"`))}
          ${field('Closed <span class="jr-opt">(opt)</span>', inp('jf-closedAt', `type="date" value="${d.closedAt || ''}"`))}
          ${field('Setup / strategy <span class="jr-opt">(opt)</span>', inp('jf-setup', `value="${esc(d.setup || '')}" placeholder="Breakout, Pullback…"`))}
          ${field('Execution rating', `<select class="jr-input" id="jf-rating"><option value="">—</option>${[1,2,3,4,5].map(n => `<option value="${n}" ${String(d.rating) === String(n) ? 'selected' : ''}>${'★'.repeat(n)}</option>`).join('')}</select>`)}
        </div>
        ${field('Notes — what went right / wrong', `<textarea class="jr-input jr-textarea" id="jf-notes" rows="2" placeholder="Plan, emotions, mistakes…">${esc(d.notes || '')}</textarea>`)}
        <div class="jr-preview" id="jf-preview"></div>
        <div class="jr-form-actions">
          <button type="button" class="jr-cancel" id="jf-cancel">Cancel</button>
          <button type="submit" class="jr-save">${d.id ? 'Save changes' : 'Add trade'}</button>
        </div>
      </form>`;
  }

  function investForm(d) {
    const sel = (id, val, opts) => `<select class="jr-input" id="${id}">${opts.map(o =>
      `<option value="${o}" ${String(val) === String(o) ? 'selected' : ''}>${o}</option>`).join('')}</select>`;
    return `
      <form class="jr-form" id="jrForm">
        <div class="jr-form-title">${d.id ? 'Edit position' : 'New position'}</div>
        <div class="jr-grid">
          ${field('Symbol', `<div class="jr-sym-wrap">${inp('jf-symbol', `value="${esc(d.symbol || '')}" maxlength="10" placeholder="AAPL"`)}<span class="jr-sym-hint" id="jf-hint"></span></div>`)}
          ${field('Action', sel('jf-action', d.action || 'buy', ['buy', 'add', 'trim', 'sell', 'review']))}
          ${field('Price', inp('jf-price', `type="number" step="any" value="${d.price ?? ''}" placeholder="0.00"`))}
          ${field('Size (shares)', inp('jf-size', `type="number" step="any" value="${d.size ?? ''}" placeholder="0"`))}
          ${field('Conviction', `<select class="jr-input" id="jf-conviction"><option value="">—</option>${[1,2,3,4,5].map(n => `<option value="${n}" ${String(d.conviction) === String(n) ? 'selected' : ''}>${'★'.repeat(n)}</option>`).join('')}</select>`)}
          ${field('Time horizon', sel('jf-horizon', d.horizon || '1-3y', ['<1y', '1-3y', '3-5y', '5y+']))}
          ${field('Target allocation % <span class="jr-opt">(opt)</span>', inp('jf-targetAllocation', `type="number" step="any" value="${d.targetAllocation ?? ''}" placeholder="5"`))}
          ${field('Date', inp('jf-date', `type="date" value="${d.date || today()}"`))}
        </div>
        ${field('Thesis — why you bought', `<textarea class="jr-input jr-textarea" id="jf-thesis" rows="2" placeholder="The reason and catalysts…">${esc(d.thesis || '')}</textarea>`)}
        ${field('Review notes <span class="jr-opt">(opt)</span>', `<textarea class="jr-input jr-textarea" id="jf-reviewNotes" rows="2" placeholder="Is the thesis still intact?">${esc(d.reviewNotes || '')}</textarea>`)}
        <div class="jr-preview" id="jf-preview"></div>
        <div class="jr-form-actions">
          <button type="button" class="jr-cancel" id="jf-cancel">Cancel</button>
          <button type="submit" class="jr-save">${d.id ? 'Save changes' : 'Add position'}</button>
        </div>
      </form>`;
  }

  function wireForm(type) {
    const form = $('jrForm');
    $('jf-cancel').onclick = closeForm;

    // symbol auto-fill
    const symEl = $('jf-symbol');
    const autofill = async () => {
      const q = await fetchQuote(symEl.value.trim());
      const hint = $('jf-hint');
      if (q && q.price != null) {
        hint.textContent = `${q.company} · ${money(q.price)}`;
        const priceField = type === 'trade' ? $('jf-entry') : $('jf-price');
        if (priceField && !priceField.value) priceField.value = q.price;
      } else { hint.textContent = symEl.value ? 'No live price' : ''; }
      updatePreview(type);
    };
    symEl.addEventListener('blur', autofill);
    symEl.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); autofill(); } });

    if (type === 'trade') {
      $('jf-dir').querySelectorAll('.jr-seg-btn').forEach(b => b.onclick = () => {
        $('jf-dir').querySelectorAll('.jr-seg-btn').forEach(x => x.classList.remove('active'));
        b.classList.add('active'); $('jf-direction').value = b.dataset.dir; updatePreview(type);
      });
    }

    form.addEventListener('input', () => updatePreview(type));
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const entry = collect(type);
      if (!entry.symbol) { symEl.focus(); return; }
      if (dayLimitBlocks(entry)) { showPaywall(); return; }   // free 15-day cap
      await saveEntry(entry);
      closeForm(); render();
    });
    updatePreview(type);
  }

  function collect(type) {
    const v = id => { const el = $(id); return el ? el.value.trim() : ''; };
    const base = {
      id: state.editingId || uuid(),
      type,
      symbol: v('jf-symbol').toUpperCase(),
      updatedAt: new Date().toISOString(),
    };
    const existing = state.entries.find(x => x.id === base.id);
    base.createdAt = existing ? existing.createdAt : new Date().toISOString();

    if (type === 'trade') {
      return { ...base,
        direction: v('jf-direction') || 'long',
        entry: v('jf-entry'), exit: v('jf-exit'), size: v('jf-size'),
        stop: v('jf-stop'), target: v('jf-target'), fees: v('jf-fees'),
        openedAt: v('jf-openedAt'), closedAt: v('jf-closedAt'),
        setup: v('jf-setup'), rating: v('jf-rating'), notes: v('jf-notes') };
    }
    return { ...base,
      action: v('jf-action'), price: v('jf-price'), size: v('jf-size'),
      conviction: v('jf-conviction'), horizon: v('jf-horizon'),
      targetAllocation: v('jf-targetAllocation'), date: v('jf-date'),
      thesis: v('jf-thesis'), reviewNotes: v('jf-reviewNotes') };
  }

  function updatePreview(type) {
    const el = $('jf-preview'); if (!el) return;
    const d = collect(type);
    if (type === 'trade') {
      const c = computeTrade(d);
      if (!c.closed) { el.innerHTML = `<span class="jr-prev-dim">Open trade — enter an exit price to see P&L</span>`; return; }
      const cls = c.pnl >= 0 ? 'pos' : 'neg';
      el.innerHTML = `
        <span class="jr-prev-item ${cls}">P&L ${money(c.pnl)}</span>
        <span class="jr-prev-item ${cls}">${pct(c.pnlPct)}</span>
        <span class="jr-prev-item">${c.r == null ? 'set a stop for R' : rfmt(c.r)}</span>
        ${c.days != null ? `<span class="jr-prev-item">${c.days}d</span>` : ''}`;
    } else {
      const c = computeInvestment(d);
      el.innerHTML = `<span class="jr-prev-item">Cost basis ${money(c.cost)}</span>`
        + (c.ret != null ? `<span class="jr-prev-item ${c.ret >= 0 ? 'pos' : 'neg'}">${pct(c.ret)} now</span>` : '');
    }
  }

  // ── CSV export (account only) ─────────────────────────────
  function exportCSV() {
    if (!authed()) { const b = $('openRegisterBtn') || $('openLoginBtn'); if (b) b.click(); return; }
    const items = state.entries.filter(e => e.type === state.type);
    if (!items.length) return;
    let head, rows;
    if (state.type === 'trade') {
      head = ['Symbol', 'Direction', 'Entry', 'Exit', 'Size', 'Stop', 'Fees', 'Opened', 'Closed', 'P&L', 'P&L %', 'R', 'Setup', 'Rating', 'Notes'];
      rows = items.map(e => { const c = computeTrade(e); return [e.symbol, e.direction, e.entry, e.exit, e.size, e.stop, e.fees, e.openedAt, e.closedAt, c.pnl, c.pnlPct, c.r, e.setup, e.rating, e.notes]; });
    } else {
      head = ['Symbol', 'Action', 'Price', 'Size', 'Cost', 'Conviction', 'Horizon', 'TargetAlloc%', 'Date', 'Thesis', 'Review'];
      rows = items.map(e => { const c = computeInvestment(e); return [e.symbol, e.action, e.price, e.size, c.cost, e.conviction, e.horizon, e.targetAllocation, e.date, e.thesis, e.reviewNotes]; });
    }
    const csv = [head, ...rows].map(r => r.map(cell => {
      const s = cell == null ? '' : String(cell);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `brickstreet-${state.type}-journal-${today()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // ── P&L calendar ──────────────────────────────────────────
  // Available to every logged-in account. Free accounts may journal trades on
  // up to FREE_DAY_LIMIT distinct days; the next new day prompts a Pro upgrade.
  const FREE_DAY_LIMIT = 15;
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const pad2 = n => String(n).padStart(2, '0');
  const dayKey = (y, m, d) => `${y}-${pad2(m + 1)}-${pad2(d)}`;

  // Net realised P&L per calendar day, keyed 'YYYY-MM-DD' → {pnl, count}.
  function pnlByDay() {
    const map = {};
    state.entries.filter(e => e.type === 'trade').forEach(e => {
      const c = computeTrade(e);
      if (!c.closed || c.pnl == null) return;
      const day = tradeDay(e);
      if (!day) return;
      (map[day] || (map[day] = { pnl: 0, count: 0 }));
      map[day].pnl += c.pnl;
      map[day].count += 1;
    });
    return map;
  }

  // Distinct days that already hold a trade (optionally ignoring one entry id).
  function distinctTradeDays(excludeId) {
    const set = new Set();
    state.entries.forEach(e => {
      if (e.type !== 'trade' || e.id === excludeId) return;
      const d = tradeDay(e);
      if (d) set.add(d);
    });
    return set;
  }

  // Would saving this entry push a free account past its day allowance?
  function dayLimitBlocks(entry) {
    if (entry.type !== 'trade') return false;       // calendar tracks trades only
    if (!authed() || isPro()) return false;         // guests (local) & pro: unlimited
    const day = tradeDay(entry);
    if (!day) return false;
    const used = distinctTradeDays(entry.id);
    if (used.has(day)) return false;                // day already logged — fine
    return used.size >= FREE_DAY_LIMIT;             // brand-new day beyond the cap
  }

  function ensureCalEl() {
    let el = $('jrCalOverlay');
    if (el) return el;
    el = document.createElement('div');
    el.className = 'jr-cal-overlay';
    el.id = 'jrCalOverlay';
    document.body.appendChild(el);
    el.addEventListener('click', ev => { if (ev.target === el) closeCalendar(); });
    return el;
  }

  function openCalendar() {
    if (!authed()) return;                          // logged-in accounts only
    const now = new Date();
    state.cal = { year: now.getFullYear(), month: now.getMonth() };
    const el = ensureCalEl();
    // Build the static shell once so the expand animation plays only on open,
    // not on every month/year change.
    el.innerHTML = `
      <div class="jr-cal-modal" role="dialog" aria-label="Trading P&L calendar">
        <div class="jr-cal-top">
          <div class="jr-cal-title">📅 Trading P&amp;L Calendar</div>
          <button class="jr-cal-close" id="jrCalClose" aria-label="Close">✕</button>
        </div>
        <div class="jr-cal-nav">
          <button class="jr-cal-navbtn" data-nav="py" title="Previous year">«</button>
          <button class="jr-cal-navbtn" data-nav="pm" title="Previous month">‹</button>
          <div class="jr-cal-period" id="jrCalPeriod"></div>
          <button class="jr-cal-navbtn" data-nav="nm" title="Next month">›</button>
          <button class="jr-cal-navbtn" data-nav="ny" title="Next year">»</button>
          <button class="jr-cal-todaybtn" data-nav="today">Today</button>
        </div>
        <div class="jr-cal-summary" id="jrCalSummary"></div>
        <div class="jr-cal-weekdays">${WEEKDAYS.map(w => `<div>${w}</div>`).join('')}</div>
        <div class="jr-cal-grid" id="jrCalGrid"></div>
        <div class="jr-cal-foot" id="jrCalFoot"></div>
      </div>`;
    $('jrCalClose').onclick = closeCalendar;
    el.querySelectorAll('[data-nav]').forEach(b => b.onclick = () => {
      const n = b.dataset.nav;
      if (n === 'py') shiftCal(-1, 0);
      else if (n === 'ny') shiftCal(1, 0);
      else if (n === 'pm') shiftCal(0, -1);
      else if (n === 'nm') shiftCal(0, 1);
      else { const t = new Date(); state.cal = { year: t.getFullYear(), month: t.getMonth() }; renderCalendar(false); }
    });
    document.body.style.overflow = 'hidden';        // lock page scroll behind the overlay
    document.addEventListener('keydown', onCalKey);
    // Add .open on the next frame so the CSS expand transition fires from scratch.
    requestAnimationFrame(() => el.classList.add('open'));
    renderCalendar(true);
  }

  function closeCalendar() {
    const el = $('jrCalOverlay');
    if (el) el.classList.remove('open');
    state.cal = null;
    document.body.style.overflow = '';
    document.removeEventListener('keydown', onCalKey);
  }

  function onCalKey(ev) {
    if (ev.key === 'Escape') closeCalendar();
    else if (ev.key === 'ArrowLeft')  shiftCal(0, -1);
    else if (ev.key === 'ArrowRight') shiftCal(0, 1);
  }

  function shiftCal(dy, dm) {
    if (!state.cal) return;
    const d = new Date(state.cal.year, state.cal.month + dm, 1);
    state.cal = { year: d.getFullYear() + dy, month: d.getMonth() };
    renderCalendar(false);
  }

  // Fill the dynamic parts of the calendar. `firstOpen` triggers the staggered
  // day-cell reveal; month/year changes get a quick grid crossfade instead.
  function renderCalendar(firstOpen) {
    if (!state.cal) return;
    const periodEl = $('jrCalPeriod');
    if (!periodEl) return;
    const { year, month } = state.cal;
    const data = pnlByDay();

    const first   = new Date(year, month, 1);
    const lead    = (first.getDay() + 6) % 7;          // Monday-start offset
    const nDays   = new Date(year, month + 1, 0).getDate();
    const now     = new Date();
    const todayK  = dayKey(now.getFullYear(), now.getMonth(), now.getDate());

    periodEl.innerHTML = `${MONTHS[month]} <span>${year}</span>`;

    // month totals
    let monthPnl = 0, winDays = 0, lossDays = 0, tradeCount = 0;
    for (let d = 1; d <= nDays; d++) {
      const cell = data[dayKey(year, month, d)];
      if (!cell) continue;
      monthPnl += cell.pnl; tradeCount += cell.count;
      if (cell.pnl > 0) winDays++; else if (cell.pnl < 0) lossDays++;
    }
    const sumCls = monthPnl > 0 ? 'pos' : monthPnl < 0 ? 'neg' : '';
    $('jrCalSummary').innerHTML = `
      <span class="jr-cal-sum-item">Net <strong class="${sumCls}">${tradeCount ? moneyShort(monthPnl) : '—'}</strong></span>
      <span class="jr-cal-sum-item">Green days <strong class="pos">${winDays}</strong></span>
      <span class="jr-cal-sum-item">Red days <strong class="neg">${lossDays}</strong></span>
      <span class="jr-cal-sum-item">Trades <strong>${tradeCount}</strong></span>`;

    let pos = 0;
    const delay = () => `style="animation-delay:${(pos++) * 9}ms"`;   // wave on open
    const cells = [];
    for (let i = 0; i < lead; i++) cells.push(`<div class="jr-cal-day jr-cal-day--blank" ${delay()}></div>`);
    for (let d = 1; d <= nDays; d++) {
      const k = dayKey(year, month, d);
      const cell = data[k];
      const cls = ['jr-cal-day'];
      if (k === todayK) cls.push('jr-cal-day--today');
      if (cell) {
        cls.push('jr-cal-day--has');
        cls.push(cell.pnl > 0 ? 'jr-cal-day--win' : cell.pnl < 0 ? 'jr-cal-day--loss' : 'jr-cal-day--flat');
      }
      cells.push(`
        <div class="${cls.join(' ')}" ${cell ? `data-goday="${k}"` : ''} ${delay()}>
          <span class="jr-cal-daynum">${d}</span>
          ${cell ? `<span class="jr-cal-amt">${moneyShort(cell.pnl)}</span>
                    <span class="jr-cal-count">${cell.count} trade${cell.count > 1 ? 's' : ''}</span>` : ''}
        </div>`);
    }

    const grid = $('jrCalGrid');
    grid.className = 'jr-cal-grid' + (firstOpen ? ' jr-cal-grid--stagger' : '');
    grid.innerHTML = cells.join('');
    if (!firstOpen) {                                   // replay the quick crossfade
      grid.classList.remove('jr-cal-grid--swap');
      void grid.offsetWidth;
      grid.classList.add('jr-cal-grid--swap');
    }
    grid.querySelectorAll('[data-goday]').forEach(c => c.onclick = () => gotoDay(c.dataset.goday));

    // Footer: free-tier quota + jump hint.
    const isFree = authed() && !isPro();
    const used   = distinctTradeDays(null).size;
    $('jrCalFoot').innerHTML =
      (isFree ? `<div class="jr-cal-quota">
           <span>Free plan · <strong>${used}/${FREE_DAY_LIMIT}</strong> trading days used</span>
           <button class="jr-cal-upsell" id="jrCalUpsell">Upgrade to Pro — unlimited →</button>
         </div>` : '') +
      `<div class="jr-cal-hint">Click a day to jump to its trades in the list.</div>`;
    const up = $('jrCalUpsell');
    if (up) up.onclick = showPaywall;
  }

  // Jump from a calendar day to its trade card(s) in the list and pulse them.
  function gotoDay(day) {
    closeCalendar();
    if (state.type !== 'trade') setType('trade'); else render();
    requestAnimationFrame(() => {
      const cards = [...document.querySelectorAll(`.jr-card[data-day="${day}"]`)];
      if (!cards.length) return;
      cards[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => cards.forEach(c => {
        c.classList.remove('jr-card--flash');
        void c.offsetWidth;                       // restart the animation
        c.classList.add('jr-card--flash');
        setTimeout(() => c.classList.remove('jr-card--flash'), 1300);
      }), 220);
    });
  }

  // ── Pro upgrade paywall ───────────────────────────────────
  function ensurePaywallEl() {
    let el = $('jrPaywall');
    if (el) return el;
    el = document.createElement('div');
    el.className = 'jr-pay-overlay';
    el.id = 'jrPaywall';
    document.body.appendChild(el);
    el.addEventListener('click', ev => { if (ev.target === el) closePaywall(); });
    return el;
  }

  function showPaywall(opts) {
    opts = (opts && typeof opts.title === 'string') ? opts : {};   // ignore event args
    const title = opts.title || "You've reached the free limit";
    const sub = opts.sub || `Free accounts can journal up to <strong>${FREE_DAY_LIMIT} trading days</strong>.
          Upgrade to <strong>Brick Street Pro</strong> for unlimited days, the full P&amp;L calendar,
          analytics &amp; CSV export.`;
    const el = ensurePaywallEl();
    el.innerHTML = `
      <div class="jr-pay-modal" role="dialog" aria-label="Upgrade to Pro">
        <button class="jr-pay-close" id="jrPayClose" aria-label="Close">✕</button>
        <div class="jr-pay-badge">PRO</div>
        <div class="jr-pay-title">${title}</div>
        <div class="jr-pay-sub">${sub}</div>
        <div class="jr-pay-price">$5<span>/month</span></div>
        <button class="jr-pay-cta" id="jrPayCta">Upgrade to Pro</button>
        <button class="jr-pay-later" id="jrPayLater">Maybe later</button>
        <div class="jr-pay-note" id="jrPayNote"></div>
      </div>`;
    $('jrPayClose').onclick = closePaywall;
    $('jrPayLater').onclick = closePaywall;
    $('jrPayCta').onclick = () => {
      const note = $('jrPayNote');
      if (note) note.textContent = 'Card checkout is launching soon — your account is flagged for early access.';
    };
    requestAnimationFrame(() => el.classList.add('open'));
  }
  function closePaywall() { const el = $('jrPaywall'); if (el) el.classList.remove('open'); }

  // Guests clicking the locked calendar get a teaser that previews the feature
  // and nudges them to register (a free account already unlocks it).
  function showLockedTeaser() {
    const el = ensurePaywallEl();
    el.innerHTML = `
      <div class="jr-pay-modal jr-pay-modal--teaser" role="dialog" aria-label="Unlock the P&L Calendar">
        <button class="jr-pay-close" id="jrPayClose" aria-label="Close">✕</button>
        <div class="jr-pay-badge jr-pay-badge--lock">🔒 LOCKED</div>
        <div class="jr-pay-title">Unlock the P&amp;L Calendar</div>
        <div class="jr-teaser-grid" aria-hidden="true">
          <div class="jr-teaser-cell win"><span>8</span><b>+$320</b></div>
          <div class="jr-teaser-cell loss"><span>9</span><b>-$140</b></div>
          <div class="jr-teaser-cell win"><span>10</span><b>+$95</b></div>
          <div class="jr-teaser-cell"><span>11</span></div>
          <div class="jr-teaser-cell loss"><span>12</span><b>-$60</b></div>
          <div class="jr-teaser-cell win"><span>15</span><b>+$210</b></div>
        </div>
        <div class="jr-pay-sub">See every trade on a calendar — <strong>green days</strong> and
          <strong>red days</strong> at a glance. Spot your patterns and click any day to jump
          straight to those trades. <strong>Free to start.</strong></div>
        <button class="jr-pay-cta" id="jrTeaserReg">Create a free account</button>
        <button class="jr-pay-later" id="jrTeaserLogin">Already have an account? Log in</button>
      </div>`;
    $('jrPayClose').onclick = closePaywall;
    $('jrTeaserReg').onclick   = () => { closePaywall(); const b = $('openRegisterBtn') || $('openLoginBtn'); if (b) b.click(); };
    $('jrTeaserLogin').onclick = () => { closePaywall(); const b = $('openLoginBtn'); if (b) b.click(); };
    requestAnimationFrame(() => el.classList.add('open'));
  }

  // Calendar button is always visible; guests see it locked (clicking it shows
  // a "register to unlock" teaser instead of opening the calendar).
  function updateCalBtn() {
    const btn = $('jrCalBtn');
    if (btn) {
      btn.style.display = 'inline-flex';
      btn.classList.toggle('jr-locked', !authed());
    }
    if (!authed() && state.cal) closeCalendar();
  }

  // ── type toggle + buttons ─────────────────────────────────
  function setType(t) {
    if (state.type === t) return;
    state.type = t;
    document.querySelectorAll('.jr-type-btn').forEach(b => b.classList.toggle('active', b.dataset.jtype === t));
    closeForm();
    render();
  }

  // ── login/logout: migrate local → account, then refresh ───
  window.addEventListener('bs:auth', async ev => {
    const user = ev.detail && ev.detail.user;
    state.user = user || null;
    updateCalBtn();
    if (user) {
      const local = localGet();
      if (local.length) {
        try {
          await api('/api/journal', { method: 'POST', body: JSON.stringify({ entries: local.map(entryToServer) }) });
          localStorage.removeItem(LS_KEY);
        } catch (_) {}
      }
    }
    await loadEntries();
    render();
  });

  // Independently confirm the tier on load (covers a reload with an existing
  // token, in case the bs:auth broadcast fired before this module was listening).
  async function refreshUser() {
    if (!authed()) { state.user = null; updateCalBtn(); return; }
    try {
      const r = await api('/api/auth/me');
      state.user = r.user || null;
    } catch (_) { /* keep whatever bs:auth gave us */ }
    updateCalBtn();
  }

  // ── init ──────────────────────────────────────────────────
  function init() {
    document.querySelectorAll('.jr-type-btn').forEach(b => b.onclick = () => setType(b.dataset.jtype));
    $('jrAddBtn').onclick = () => { state.formOpen ? closeForm() : openForm(state.type, null); };
    $('jrExportBtn').onclick = exportCSV;
    const calBtn = $('jrCalBtn');
    if (calBtn) calBtn.onclick = () => { authed() ? openCalendar() : showLockedTeaser(); };
    updateCalBtn();
    refreshUser();
    loadEntries().then(render);
  }

  window.Journal = {
    init,
    onShow() { loadEntries().then(render); },
    quickAdd(symbol) {
      const tab = document.querySelector('.view-tab[data-view="journal"]');
      if (tab) tab.click();
      setType('trade');
      openForm('trade', { symbol: (symbol || '').toUpperCase() });
      const s = $('jf-symbol'); if (s) s.dispatchEvent(new Event('blur'));
    },
    // Reusable Pro upgrade modal — pass {title, sub} to tailor the message
    // (used by the watchlist 15-stock cap, etc.).
    showUpgrade: showPaywall,
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
