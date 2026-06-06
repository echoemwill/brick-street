/* ────────────────────────────────────────────────────────────
   Brick Street — Trading & Investment Journal
   - Logged out  → entries saved in localStorage (unlimited, device-only)
   - Logged in   → entries synced to the account (analytics + CSV export)
   On login, any local entries are pushed up to the account once.
   ──────────────────────────────────────────────────────────── */
(function () {
  const LS_KEY = 'bs_journal_entries';

  const state = { type: 'trade', entries: [], formOpen: false, editingId: null };
  const priceCache = {};            // symbol → {price, company} | null

  // ── tiny helpers ──────────────────────────────────────────
  const $  = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const token  = () => localStorage.getItem('bs_token');
  const authed = () => !!token();
  const uuid   = () => (crypto.randomUUID ? crypto.randomUUID()
    : 'id-' + Date.now() + '-' + Math.random().toString(16).slice(2));
  const num = v => (v === '' || v == null || isNaN(+v)) ? null : +v;
  const today = () => new Date().toISOString().slice(0, 10);

  const money = v => v == null ? '—'
    : (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pct = v => v == null ? '—' : (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
  const rfmt = v => v == null ? '—' : (v >= 0 ? '+' : '') + v.toFixed(2) + 'R';

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
    const exp = $('jrExportBtn');
    if (exp) exp.classList.toggle('jr-locked', !authed());
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
      <div class="jr-card jr-card--${dirCls}">
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

  // ── init ──────────────────────────────────────────────────
  function init() {
    document.querySelectorAll('.jr-type-btn').forEach(b => b.onclick = () => setType(b.dataset.jtype));
    $('jrAddBtn').onclick = () => { state.formOpen ? closeForm() : openForm(state.type, null); };
    $('jrExportBtn').onclick = exportCSV;
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
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
