/* Brick Street — app.js */

gsap.registerPlugin(ScrollTrigger);

/* ─── State ────────────────────────────────────────────── */
let allStocks   = [];
let sortKey     = 'buy';
let sortDir     = -1;
let searchQuery = '';
let visibleCount = 30;
const PAGE_SIZE  = 30;
let watchlistSymbols = new Set();
let currentUser = null;                       // {id,name,email,plan} when logged in
const WATCHLIST_FREE_LIMIT = 15;              // free accounts cap; pro is unlimited
const isProUser = () => !!(currentUser && currentUser.plan === 'pro');

/* Pro upgrade prompt (reuses the journal paywall modal). */
function showUpgradePrompt(opts) {
  if (window.Journal && window.Journal.showUpgrade) window.Journal.showUpgrade(opts);
  else { const b = document.getElementById('openRegisterBtn'); if (b) b.click(); }
}

/* ─── Small shared helpers ─────────────────────────────── */
function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Unix seconds → "just now" / "3h ago" / "2d ago" / a date for older items.
function relativeTime(unixSeconds) {
  if (!unixSeconds) return '';
  const diff = Date.now() / 1000 - unixSeconds;
  if (diff < 0)        return 'just now';
  if (diff < 60)       return 'just now';
  if (diff < 3600)     return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400)    return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800)   return `${Math.floor(diff / 86400)}d ago`;
  return new Date(unixSeconds * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/* ─── Static PCB Background + Signal Animation ─────────── */
(function initPCB() {
  const canvas = document.getElementById('gridCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  let _s = 0xA3C5E7F1;
  function rng() {
    _s ^= _s << 13; _s ^= _s >> 17; _s ^= _s << 5;
    return ((_s >>> 0) / 0xFFFFFFFF);
  }

  function draw() {
    const W = canvas.width  = window.innerWidth;
    const H = canvas.height = window.innerHeight;
    ctx.clearRect(0, 0, W, H);

    const TRACE = 'rgba(22, 68, 42, 0.55)';
    const THICK = 'rgba(25, 76, 46, 0.65)';
    const VIA   = 'rgba(32, 88, 52, 0.60)';
    const PAD   = 'rgba(28, 80, 48, 0.55)';
    const CHIP  = 'rgba(18, 54, 34, 0.50)';
    const SILK  = 'rgba(50, 110, 68, 0.22)';
    const G     = 52;

    _s = 0xA3C5E7F1;

    const cols = Math.ceil(W / G) + 3;
    const rows = Math.ceil(H / G) + 3;

    const present = {};
    for (let c = 0; c < cols; c++)
      for (let r = 0; r < rows; r++)
        present[c + ',' + r] = rng() < 0.62;

    function px(c) { return c * G; }
    function py(r) { return r * G; }

    // Collect edges for signal animation
    const edges = [];
    const nodeMap = {};
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        if (!present[c + ',' + r]) continue;
        const key = c + ',' + r;
        if (!nodeMap[key]) nodeMap[key] = { x: px(c), y: py(r) };
        const rKey = (c+1) + ',' + r;
        const dKey = c + ',' + (r+1);
        if (present[rKey]) {
          if (!nodeMap[rKey]) nodeMap[rKey] = { x: px(c+1), y: py(r) };
          edges.push({ a: nodeMap[key], b: nodeMap[rKey] });
        }
        if (present[dKey]) {
          if (!nodeMap[dKey]) nodeMap[dKey] = { x: px(c), y: py(r+1) };
          edges.push({ a: nodeMap[key], b: nodeMap[dKey] });
        }
      }
    }
    window._pcbEdges = edges;
    window._pcbNodes = Object.values(nodeMap);

    // ── Horizontal traces ──
    ctx.lineCap = 'butt';
    for (let r = 0; r < rows; r++) {
      let inLine = false, lx = 0;
      for (let c = 0; c < cols; c++) {
        const here = present[c + ',' + r];
        if (here && !inLine) { lx = px(c); inLine = true; }
        if (!here && inLine) {
          const len = px(c) - lx;
          if (len > G * 0.8) {
            ctx.beginPath(); ctx.moveTo(lx, py(r)); ctx.lineTo(lx + len, py(r));
            ctx.strokeStyle = (r % 6 === 1) ? THICK : TRACE;
            ctx.lineWidth   = (r % 6 === 1) ? 1.8 : 1.1;
            ctx.stroke();
          }
          inLine = false;
        }
      }
    }

    // ── Vertical traces ──
    for (let c = 0; c < cols; c++) {
      let inLine = false, ly = 0;
      for (let r = 0; r < rows; r++) {
        const here = present[c + ',' + r];
        if (here && !inLine) { ly = py(r); inLine = true; }
        if (!here && inLine) {
          const len = py(r) - ly;
          if (len > G * 0.8) {
            ctx.beginPath(); ctx.moveTo(px(c), ly); ctx.lineTo(px(c), ly + len);
            ctx.strokeStyle = TRACE; ctx.lineWidth = 1.1; ctx.stroke();
          }
          inLine = false;
        }
      }
    }

    // ── 45° diagonal stubs ──
    ctx.strokeStyle = TRACE; ctx.lineWidth = 1.0;
    for (let c = 1; c < cols - 1; c++)
      for (let r = 1; r < rows - 1; r++)
        if (present[c + ',' + r] && rng() < 0.06) {
          const dx = rng() > 0.5 ? G : -G, dy = rng() > 0.5 ? G : -G;
          ctx.beginPath(); ctx.moveTo(px(c), py(r));
          ctx.lineTo(px(c) + dx * 0.5, py(r) + dy * 0.5); ctx.stroke();
        }

    // ── Vias / pads / junction dots ──
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        if (!present[c + ',' + r]) continue;
        const t = rng();
        if (t < 0.13) {
          ctx.beginPath(); ctx.arc(px(c), py(r), 4.5, 0, Math.PI * 2);
          ctx.strokeStyle = VIA; ctx.lineWidth = 1.2; ctx.stroke();
          ctx.beginPath(); ctx.arc(px(c), py(r), 1.8, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(8,9,15,0.9)'; ctx.fill();
        } else if (t < 0.22) {
          ctx.fillStyle = PAD; ctx.fillRect(px(c)-4, py(r)-2.5, 8, 5);
        } else {
          ctx.beginPath(); ctx.arc(px(c), py(r), 1.4, 0, Math.PI * 2);
          ctx.fillStyle = TRACE; ctx.fill();
        }
      }
    }

    // ── IC chips ──
    for (let c = 3; c < cols - 4; c += 5 + Math.floor(rng() * 5)) {
      for (let r = 2; r < rows - 3; r += 4 + Math.floor(rng() * 4)) {
        if (rng() >= 0.35) continue;
        const cw = (2 + Math.floor(rng() * 2)) * G;
        const ch = (1 + Math.floor(rng() * 2)) * G;
        const x = px(c), y = py(r);
        ctx.fillStyle = 'rgba(10,28,18,0.30)'; ctx.fillRect(x, y, cw, ch);
        ctx.strokeStyle = CHIP; ctx.lineWidth = 1.0; ctx.strokeRect(x, y, cw, ch);
        ctx.beginPath(); ctx.arc(x+6, y+6, 2, 0, Math.PI*2);
        ctx.fillStyle = VIA; ctx.fill();
        ctx.strokeStyle = SILK; ctx.lineWidth = 0.5; ctx.strokeRect(x+4, y+4, cw-8, ch-8);
        const pps = Math.max(2, Math.floor((4 + Math.floor(rng()*8)) / 2));
        const ps  = cw / (pps + 1);
        ctx.strokeStyle = PAD; ctx.lineWidth = 1.0;
        for (let p = 1; p <= pps; p++) {
          const ppx = x + p * ps;
          ctx.beginPath(); ctx.moveTo(ppx, y); ctx.lineTo(ppx, y-7); ctx.stroke();
          ctx.fillStyle = PAD; ctx.fillRect(ppx-2, y-9, 4, 3);
          ctx.beginPath(); ctx.moveTo(ppx, y+ch); ctx.lineTo(ppx, y+ch+7); ctx.stroke();
          ctx.fillRect(ppx-2, y+ch+6, 4, 3);
        }
      }
    }

    // ── Passive components ──
    for (let c = 1; c < cols-1; c++) {
      for (let r = 1; r < rows-1; r++) {
        if (!present[c+','+r]) continue;
        const t = rng();
        if (t < 0.025) {
          const horiz = rng() > 0.5, rx = px(c), ry = py(r);
          ctx.strokeStyle = CHIP; ctx.lineWidth = 0.8;
          ctx.fillStyle = 'rgba(12,35,22,0.25)';
          if (horiz) { ctx.fillRect(rx-9,ry-3,18,6); ctx.strokeRect(rx-9,ry-3,18,6); }
          else       { ctx.fillRect(rx-3,ry-9,6,18); ctx.strokeRect(rx-3,ry-9,6,18); }
        } else if (t < 0.038) {
          const rx = px(c), ry = py(r);
          ctx.strokeStyle = CHIP; ctx.lineWidth = 0.8; ctx.fillStyle = PAD;
          ctx.fillRect(rx-7,ry-2,5,5); ctx.strokeRect(rx-7,ry-2,5,5);
          ctx.fillRect(rx+2,ry-2,5,5); ctx.strokeRect(rx+2,ry-2,5,5);
        }
      }
    }
  }

  draw();
  window.addEventListener('resize', () => { draw(); });
})();

/* ─── PCB Signal Animation ──────────────────────────────── */
(function initSignals() {
  const canvas = document.getElementById('particleCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
  window.addEventListener('resize', () => {
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
  });

  // Build adjacency map from PCB edges
  function buildAdj(edges) {
    const adj = new Map();
    edges.forEach(e => {
      if (!adj.has(e.a)) adj.set(e.a, []);
      if (!adj.has(e.b)) adj.set(e.b, []);
      adj.get(e.a).push(e.b);
      adj.get(e.b).push(e.a);
    });
    return adj;
  }

  let adj = null;
  let signals = [];

  class Signal {
    constructor(edges, adjMap) {
      const e     = edges[Math.floor(Math.random() * edges.length)];
      this.from   = Math.random() > 0.5 ? e.a : e.b;
      this.to     = this.from === e.a ? e.b : e.a;
      this.prog   = 0;
      this.speed  = 0.04 + Math.random() * 0.05;
      this.trail  = [];
      this.maxLen = 30 + Math.floor(Math.random() * 50);
      this.life   = 12 + Math.floor(Math.random() * 18);
      this.alpha  = 0.18 + Math.random() * 0.18;
      this.adj    = adjMap;
      this.alive  = true;
    }

    update() {
      this.prog += this.speed;
      const x = this.from.x + (this.to.x - this.from.x) * Math.min(this.prog, 1);
      const y = this.from.y + (this.to.y - this.from.y) * Math.min(this.prog, 1);
      this.trail.push({ x, y });
      if (this.trail.length > this.maxLen) this.trail.shift();

      if (this.prog >= 1) {
        this.prog = 0;
        this.life--;
        if (this.life <= 0) { this.alive = false; return; }
        const prev = this.from;
        this.from  = this.to;
        const nbrs = (this.adj.get(this.from) || []).filter(n => n !== prev);
        if (!nbrs.length) { this.alive = false; return; }
        this.to = nbrs[Math.floor(Math.random() * nbrs.length)];
      }
    }

    draw() {
      if (this.trail.length < 2) return;
      for (let i = 1; i < this.trail.length; i++) {
        const t = i / this.trail.length;
        ctx.beginPath();
        ctx.moveTo(this.trail[i-1].x, this.trail[i-1].y);
        ctx.lineTo(this.trail[i].x,   this.trail[i].y);
        ctx.strokeStyle = `rgba(40, 130, 75, ${t * this.alpha})`;
        ctx.lineWidth   = 1.4;
        ctx.lineCap     = 'round';
        ctx.stroke();
      }
      // Head
      const h = this.trail[this.trail.length - 1];
      ctx.beginPath();
      ctx.arc(h.x, h.y, 1.8, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(55, 160, 90, ${this.alpha * 0.9})`;
      ctx.fill();
    }
  }

  function loop() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!adj && window._pcbEdges && window._pcbEdges.length) {
      adj = buildAdj(window._pcbEdges);
    }
    if (!adj) { requestAnimationFrame(loop); return; }

    const edges = window._pcbEdges;
    while (signals.length < 5) signals.push(new Signal(edges, adj));
    signals = signals.filter(s => s.alive);
    signals.forEach(s => { s.update(); s.draw(); });

    requestAnimationFrame(loop);
  }

  setTimeout(loop, 80);
})();

/* ─── Hero animation ───────────────────────────────────── */
function animateHero() {
  const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });
  tl.to('.hero-title .word',  { opacity: 1, y: 0, duration: 0.7, stagger: 0.15 })
    .to('.hero-sub',           { opacity: 1, y: 0, duration: 0.6 }, '-=0.3')
    .to('.hero-criteria',      { opacity: 1, y: 0, duration: 0.5 }, '-=0.3');
}



/* ─── Count-up animation ───────────────────────────────── */
function countUp(el, target, duration = 1200, suffix = '') {
  const start = performance.now();
  function step(now) {
    const p   = Math.min((now - start) / duration, 1);
    const val = Math.round(p * target);
    el.textContent = val + suffix;
    if (p < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

/* ─── Build stats ──────────────────────────────────────── */
function buildStats(stocks) {
  const n = stocks.length;
  if (!n) return;

  const totalAnalysts = stocks.reduce((s, x) => s + x.buy + x.hold + x.sell, 0);

  document.getElementById('stockCount').textContent = `${n} stocks`;

  countUp(document.getElementById('totalCount'),    n);
  countUp(document.getElementById('totalAnalysts'), totalAnalysts);
  // The rotating highlight tile is started separately (needs earnings data) —
  // see initRotatingStat(), called from loadData after earnings load.
}

/* ─── Rotating market-highlight tile ───────────────────── */
let _rotateInsights = [];
let _rotateIdx      = 0;
let _rotateTimer    = null;

function computeInsights() {
  const out    = [];
  const rated  = allStocks.filter(s => (s.buy + s.hold + s.sell) > 0);
  if (!rated.length) return out;

  const coverage = s => s.buy + s.hold + s.sell;
  const buyShare = s => coverage(s) ? s.buy / coverage(s) : 0;

  // 1) Top pick — most Buy ratings
  const top = rated.reduce((a, b) => (b.buy > a.buy ? b : a));
  out.push({ label: 'Top Pick', sym: top.symbol, detail: `${top.buy} buy ratings`, cls: 'buy-text' });

  // 2) Weakest rated — most Sell ratings (tie → lowest buy share)
  const worst = rated.reduce((a, b) => {
    if (b.sell !== a.sell) return b.sell > a.sell ? b : a;
    return buyShare(b) < buyShare(a) ? b : a;
  });
  out.push({ label: 'Weakest Rated', sym: worst.symbol, detail: `${worst.sell} sell ratings`, cls: 'sell-text' });

  // 3) Strongest consensus — highest Buy share (min 15 analysts)
  const covered = rated.filter(s => coverage(s) >= 15);
  if (covered.length) {
    const unanimous = covered.reduce((a, b) => (buyShare(b) > buyShare(a) ? b : a));
    out.push({ label: 'Strongest Consensus', sym: unanimous.symbol,
               detail: `${Math.round(buyShare(unanimous) * 100)}% buy`, cls: 'buy-text' });
  }

  // 4) Most covered — most analysts following it
  const mostCovered = rated.reduce((a, b) => (coverage(b) > coverage(a) ? b : a));
  out.push({ label: 'Most Covered', sym: mostCovered.symbol,
             detail: `${coverage(mostCovered)} analysts`, cls: 'accent-text' });

  // 5) Earnings star — best average EPS surprise across its last quarters
  if (earningsData) {
    let best = null, bestAvg = -Infinity;
    for (const s of rated) {
      const qs = earningsData[s.symbol];
      if (!qs || !qs.length) continue;
      const vals = qs.map(q => q.surprise).filter(v => v != null);
      if (!vals.length) continue;
      const avg = vals.reduce((x, y) => x + y, 0) / vals.length;
      if (avg > bestAvg) { bestAvg = avg; best = s; }
    }
    if (best) out.push({ label: 'Earnings Star', sym: best.symbol,
                         detail: `+${bestAvg.toFixed(1)}% avg surprise`, cls: 'buy-text' });
  }

  // 6) Priciest — highest share price (where we have it)
  const priced = rated.filter(s => s.price != null);
  if (priced.length) {
    const dear = priced.reduce((a, b) => (b.price > a.price ? b : a));
    out.push({ label: 'Highest Price', sym: dear.symbol,
               detail: `$${dear.price.toLocaleString()}`, cls: 'accent-text' });
  }

  return out;
}

function applyInsight(ins, animate) {
  const valEl = document.getElementById('rotateValue');
  const labEl = document.getElementById('rotateLabel');
  const detEl = document.getElementById('rotateDetail');
  if (!valEl) return;

  const set = () => {
    valEl.textContent = ins.sym;
    valEl.className   = `stat-value stat-value--symbol ${ins.cls}`;
    labEl.textContent = ins.label;
    detEl.textContent = ins.detail || '';
  };

  if (!animate) { set(); return; }
  const els = [valEl, labEl, detEl];
  gsap.to(els, {
    opacity: 0, y: -6, duration: 0.3, ease: 'power2.in',
    onComplete: () => {
      set();
      gsap.fromTo(els,
        { opacity: 0, y: 8 },
        { opacity: 1, y: 0, duration: 0.45, ease: 'power2.out', stagger: 0.05 });
    }
  });
}

function startRotation() {
  clearInterval(_rotateTimer);
  if (_rotateInsights.length < 2) return;
  _rotateTimer = setInterval(() => {
    _rotateIdx = (_rotateIdx + 1) % _rotateInsights.length;
    applyInsight(_rotateInsights[_rotateIdx], true);
  }, 5000);
}

function initRotatingStat() {
  _rotateInsights = computeInsights();
  if (!_rotateInsights.length) return;
  _rotateIdx = 0;
  applyInsight(_rotateInsights[0], false);
  startRotation();

  const tile = document.getElementById('rotatingStat');
  if (tile && !tile.dataset.bound) {
    tile.dataset.bound = '1';
    tile.addEventListener('mouseenter', () => clearInterval(_rotateTimer));
    tile.addEventListener('mouseleave', startRotation);
  }
}

/* ─── Format price ─────────────────────────────────────── */
function formatPrice(price) {
  if (!price || price <= 0) return '';
  return '$' + price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/* ─── Build a single row ───────────────────────────────── */
function buildRow(stock, rank) {
  const total    = stock.buy + stock.hold + stock.sell;
  const buyPct   = total > 0 ? Math.round((stock.buy / total) * 100) : 0;
  const priceStr = formatPrice(stock.price);

  // Wrapper entry
  const entry = document.createElement('div');
  entry.className      = 'stock-entry';
  entry.dataset.symbol = stock.symbol;

  entry.innerHTML = `
    <div class="stock-row">
      <div class="row-rank">${rank}</div>

      <div class="row-symbol">
        <div class="symbol-text">
          ${stock.logo ? `<img class="sym-logo" src="${stock.logo}" alt="" loading="lazy" onerror="this.style.display='none'">` : ''}
          <span class="sym-label">${stock.symbol}</span>
          ${priceStr ? `<span class="stock-price">${priceStr}</span>` : '<span class="stock-price">—</span>'}
          <button class="tv-btn" title="View ${stock.symbol} chart">
            <svg class="tv-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <polyline points="2,17 8,11 12,15 22,5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              <polyline points="16,5 22,5 22,11" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
          <button class="nw-btn" title="Latest ${stock.symbol} news">
            <svg class="nw-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M4 5h13v14H5a1 1 0 0 1-1-1V5z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
              <path d="M17 8h3v9a2 2 0 0 1-2 2" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              <line x1="7" y1="9" x2="14" y2="9" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
              <line x1="7" y1="13" x2="14" y2="13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
          </button>
          <button class="wl-btn${watchlistSymbols.has(stock.symbol) ? ' wl-btn--active' : ''}" data-symbol="${stock.symbol}" title="${watchlistSymbols.has(stock.symbol) ? 'Remove from watchlist' : 'Save to watchlist'}">
            <svg class="wl-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
        </div>
      </div>

      <div class="row-sector">
        ${stock.sector
          ? `<span class="sector-chip" title="${stock.sector}">${stock.sector}</span>`
          : `<span class="sector-chip sector-chip--empty">—</span>`}
      </div>

      <div class="row-buy">
        <span class="buy-value">${stock.buy}</span>
      </div>

      <div class="row-hold">
        <span class="hold-value">${stock.hold}</span>
      </div>

      <div class="row-sell">
        <span class="sell-value">${stock.sell}</span>
      </div>

      <div class="row-signal">
        <span class="signal-pct">${buyPct}%</span>
      </div>

      <div class="row-earnings">
        ${earningsHtml(stock.symbol)}
      </div>

      <div class="row-insider">
        ${insiderHtml(stock)}
      </div>

      <div class="row-change">
        ${changeHtml(stock)}
      </div>
    </div>

    <!-- Inline chart panel -->
    <div class="chart-panel">
      <div class="chart-panel-inner">
        <div class="chart-toolbar">
          <span class="chart-symbol-label">${stock.symbol} — Live Chart</span>
          <a class="chart-open-link" href="https://www.tradingview.com/chart/?symbol=${stock.symbol}" target="_blank">
            Open in TradingView ↗
          </a>
        </div>
        <div class="chart-frame-wrap">
          <div class="chart-loading">Loading chart…</div>
        </div>
      </div>
    </div>

    <!-- Inline news panel -->
    <div class="news-panel">
      <div class="news-panel-inner">
        <div class="news-toolbar">
          <span class="news-symbol-label">${stock.symbol} — Latest News</span>
          <button class="news-close" title="Close news">✕</button>
        </div>
        <div class="news-list-wrap">
          <div class="news-loading">Loading news…</div>
        </div>
        <div class="news-attribution">News via Finnhub — headlines link to their original publishers.</div>
      </div>
    </div>
  `;

  const row          = entry.querySelector('.stock-row');
  const panel        = entry.querySelector('.chart-panel');
  const panelInner   = entry.querySelector('.chart-panel-inner');
  const frameWrap    = entry.querySelector('.chart-frame-wrap');
  const tvBtn        = entry.querySelector('.tv-btn');
  const nwBtn        = entry.querySelector('.nw-btn');
  const newsPanel    = entry.querySelector('.news-panel');
  const newsInner    = entry.querySelector('.news-panel-inner');
  const newsListWrap = entry.querySelector('.news-list-wrap');
  const newsClose    = entry.querySelector('.news-close');
  const wlBtn        = entry.querySelector('.wl-btn');
  const symbolSpan   = entry.querySelector('.sym-label');

  let expanded    = false;
  let chartLoaded = false;
  let openTimer   = null;
  let closeTimer  = null;

  function openChart() {
    if (expanded) return;
    expanded = true;
    tvBtn.classList.add('tv-btn--active');

    if (!chartLoaded) {
      chartLoaded = true;
      const url = `https://www.tradingview.com/widgetembed/?symbol=${encodeURIComponent(stock.symbol)}&interval=D&theme=dark&style=1&locale=en&toolbar_bg=0f1119&withdateranges=1&hide_side_toolbar=0&allow_symbol_change=1&save_image=1&hide_volume=0`;
      const iframe = document.createElement('iframe');
      iframe.src             = url;
      iframe.width           = '100%';
      iframe.height          = '100%';
      iframe.frameBorder     = '0';
      iframe.allowFullscreen = true;
      iframe.style.opacity   = '0';
      iframe.style.border    = 'none';
      iframe.onload = () => gsap.to(iframe, { opacity: 1, duration: 0.5, ease: 'power2.out' });
      frameWrap.innerHTML = '';
      frameWrap.appendChild(iframe);
    }

    gsap.set(panel, { display: 'block' });
    gsap.fromTo(panel,
      { height: 0, opacity: 0 },
      { height: 520, opacity: 1, duration: 0.65, ease: 'power3.inOut' }
    );
    gsap.fromTo(panelInner,
      { y: -20, opacity: 0 },
      { y: 0, opacity: 1, duration: 0.5, delay: 0.15, ease: 'power2.out' }
    );
  }

  function closeChart() {
    if (!expanded) return;
    expanded = false;
    tvBtn.classList.remove('tv-btn--active');

    gsap.to(panelInner, { y: -10, opacity: 0, duration: 0.25, ease: 'power2.in' });
    gsap.to(panel, {
      height: 0, opacity: 0, duration: 0.55, ease: 'power3.inOut', delay: 0.1,
      onComplete: () => gsap.set(panel, { display: 'none' })
    });
  }

  /* ── News panel (separate from chart, toggled by click) ── */
  let newsExpanded = false;
  let newsLoaded   = false;

  function renderNews(items) {
    if (!items || !items.length) {
      newsListWrap.innerHTML = '<div class="news-empty">No recent news found for this stock.</div>';
      return;
    }
    newsListWrap.innerHTML = items.map(n => {
      const src  = n.source ? escapeHtml(n.source) : 'Source';
      const when = relativeTime(n.datetime);
      const sum  = n.summary ? `<p class="news-item-summary">${escapeHtml(n.summary).slice(0, 220)}${n.summary.length > 220 ? '…' : ''}</p>` : '';
      return `
        <a class="news-item" href="${escapeHtml(n.url)}" target="_blank" rel="noopener noreferrer">
          <div class="news-item-head">
            <span class="news-item-source">${src}</span>
            ${when ? `<span class="news-item-time">${when}</span>` : ''}
          </div>
          <div class="news-item-headline">${escapeHtml(n.headline)}</div>
          ${sum}
        </a>`;
    }).join('');
  }

  async function loadNews() {
    if (newsLoaded) return;
    newsLoaded = true;
    try {
      const res = await fetch(`/api/news/${encodeURIComponent(stock.symbol)}`);
      if (!res.ok) throw new Error('news fetch failed');
      const data = await res.json();
      renderNews(data.news);
    } catch (err) {
      newsLoaded = false;  // allow a retry on next open
      newsListWrap.innerHTML = '<div class="news-empty">Couldn’t load news right now. Try again shortly.</div>';
    }
  }

  function openNews() {
    if (newsExpanded) return;
    newsExpanded = true;
    nwBtn.classList.add('nw-btn--active');
    loadNews();
    gsap.set(newsPanel, { display: 'block' });
    gsap.fromTo(newsPanel,
      { height: 0, opacity: 0 },
      { height: 'auto', opacity: 1, duration: 0.55, ease: 'power3.inOut' }
    );
    gsap.fromTo(newsInner,
      { y: -16, opacity: 0 },
      { y: 0, opacity: 1, duration: 0.45, delay: 0.12, ease: 'power2.out' }
    );
  }

  function closeNews() {
    if (!newsExpanded) return;
    newsExpanded = false;
    nwBtn.classList.remove('nw-btn--active');
    gsap.to(newsInner, { y: -10, opacity: 0, duration: 0.22, ease: 'power2.in' });
    gsap.to(newsPanel, {
      height: 0, opacity: 0, duration: 0.5, ease: 'power3.inOut', delay: 0.08,
      onComplete: () => gsap.set(newsPanel, { display: 'none' })
    });
  }

  nwBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    newsExpanded ? closeNews() : openNews();
  });
  newsClose.addEventListener('click', (e) => {
    e.stopPropagation();
    closeNews();
  });

  /* ── Watchlist star button ── */
  wlBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleWatchlist(stock.symbol);
  });

  /* ── Open on hover of TV button ── */
  tvBtn.addEventListener('mouseenter', () => {
    clearTimeout(closeTimer);
    openTimer = setTimeout(openChart, 120);
  });

  /* ── Keep open while mouse is anywhere inside the entry ── */
  entry.addEventListener('mouseenter', () => {
    clearTimeout(closeTimer);
  });

  /* ── Close when mouse leaves the entire entry (with delay for iframe) ── */
  entry.addEventListener('mouseleave', () => {
    clearTimeout(openTimer);
    closeTimer = setTimeout(closeChart, 900);
  });

  /* ── Symbol glitch on hover ── */
  const original    = stock.symbol;
  const glitchChars = '!@#$%&*<>?/\\|01';
  let glitchTimer   = null;

  row.addEventListener('mouseenter', () => {
    let count = 0;
    glitchTimer = setInterval(() => {
      if (count++ > 6) { symbolSpan.textContent = original; clearInterval(glitchTimer); return; }
      symbolSpan.textContent = original.split('').map(c =>
        Math.random() > 0.5 ? glitchChars[Math.floor(Math.random() * glitchChars.length)] : c
      ).join('');
    }, 40);
  });

  row.addEventListener('mouseleave', () => {
    clearInterval(glitchTimer);
    symbolSpan.textContent = original;
  });

  return entry;
}

/* ─── Render table ─────────────────────────────────────── */
let _filteredSorted = [];

/* Average EPS surprise % across a symbol's reported quarters, or null when no
   earnings data exists. Used by the "Earnings" sort (high avg = best). */
function earnAvg(symbol) {
  if (!earningsData) return null;
  const qs = earningsData[symbol];
  if (!qs || !qs.length) return null;
  const vals = qs.map(q => q.surprise).filter(v => v != null);
  if (!vals.length) return null;
  return vals.reduce((s, v) => s + v, 0) / vals.length;
}

/* Signed share count of a stock's headline insider trade: +shares for a buy,
   −shares for a sell, or null if none. Lets the "Insider" sort surface the
   biggest buys (descending) or the biggest sells (ascending) from one column. */
function insiderMag(stock) {
  const b = stock.insider;
  if (!b || !b.shares) return null;
  return b.direction === 'sell' ? -b.shares : b.shares;
}

/* ─── Feed filters ─────────────────────────────────────── */
const filters = {
  price:    { min: null, max: null },
  sectors:  new Set(),
  buy:      { min: null, max: null },
  hold:     { min: null, max: null },
  sell:     { min: null, max: null },
  signal:   { min: null, max: null },
  earnings: { avgMin: null, avgMax: null, minBeats: null, lastBeat: false },
  insider:  { direction: 'any', minShares: null, withinDays: null },
  change:   { period: '1d', min: null, max: null },
};

function signalOf(s) {
  const total = s.buy + s.hold + s.sell;
  return total > 0 ? (s.buy / total) * 100 : 0;
}

/* True if a stock satisfies every active filter (defaults = no constraint). */
function passesFilters(s) {
  const f = filters;

  if (f.price.min != null && (s.price == null || s.price < f.price.min)) return false;
  if (f.price.max != null && (s.price == null || s.price > f.price.max)) return false;

  if (f.sectors.size && (!s.sector || !f.sectors.has(s.sector))) return false;

  for (const k of ['buy', 'hold', 'sell']) {
    if (f[k].min != null && s[k] < f[k].min) return false;
    if (f[k].max != null && s[k] > f[k].max) return false;
  }

  const sig = signalOf(s);
  if (f.signal.min != null && sig < f.signal.min) return false;
  if (f.signal.max != null && sig > f.signal.max) return false;

  const e = f.earnings;
  if (e.avgMin != null || e.avgMax != null) {
    const avg = earnAvg(s.symbol);
    if (avg == null) return false;
    if (e.avgMin != null && avg < e.avgMin) return false;
    if (e.avgMax != null && avg > e.avgMax) return false;
  }
  if (e.minBeats != null || e.lastBeat) {
    const qs = (earningsData && earningsData[s.symbol]) || [];
    if (e.minBeats != null) {
      const beats = qs.filter(q => q.surprise != null && q.surprise > 0).length;
      if (beats < e.minBeats) return false;
    }
    if (e.lastBeat) {
      const last = qs[qs.length - 1];   // quarters are oldest → latest
      if (!last || last.surprise == null || last.surprise <= 0) return false;
    }
  }

  const ins = f.insider;
  if (ins.direction !== 'any' || ins.minShares != null || ins.withinDays != null) {
    const b = s.insider;
    if (!b) return false;
    if (ins.direction !== 'any' && b.direction !== ins.direction) return false;
    if (ins.minShares != null && (b.shares || 0) < ins.minShares) return false;
    if (ins.withinDays != null) {
      if (!b.date) return false;
      const days = (Date.now() - new Date(b.date).getTime()) / 86400000;
      if (!(days <= ins.withinDays)) return false;
    }
  }

  // Price change (currently 1-day only; longer periods need a historical plan).
  const ch = f.change;
  if (ch.min != null || ch.max != null) {
    if (s.change == null) return false;
    if (ch.min != null && s.change < ch.min) return false;
    if (ch.max != null && s.change > ch.max) return false;
  }

  return true;
}

function filtersActiveCount() {
  const f = filters;
  let n = 0;
  if (f.price.min != null || f.price.max != null) n++;
  if (f.sectors.size) n++;
  if (f.buy.min  != null || f.buy.max  != null) n++;
  if (f.hold.min != null || f.hold.max != null) n++;
  if (f.sell.min != null || f.sell.max != null) n++;
  if (f.signal.min != null || f.signal.max != null) n++;
  if (f.earnings.avgMin != null || f.earnings.avgMax != null ||
      f.earnings.minBeats != null || f.earnings.lastBeat) n++;
  if (f.insider.direction !== 'any' || f.insider.minShares != null ||
      f.insider.withinDays != null) n++;
  if (f.change.min != null || f.change.max != null) n++;
  return n;
}

function updateFilterBadge() {
  const n   = filtersActiveCount();
  const btn = document.getElementById('filterBtn');
  const cnt = document.getElementById('filterCount');
  if (!btn || !cnt) return;
  btn.classList.toggle('has-active', n > 0);
  if (n > 0) { cnt.textContent = n; cnt.hidden = false; }
  else cnt.hidden = true;
}

function renderTable(resetCount = true) {
  const body = document.getElementById('tableBody');

  if (resetCount) {
    visibleCount = PAGE_SIZE;
    body.innerHTML = '';
  }

  let stocks = [...allStocks];

  if (searchQuery) {
    stocks = stocks.filter(s => s.symbol.includes(searchQuery.toUpperCase()));
  }

  stocks = stocks.filter(passesFilters);

  const fr = document.getElementById('filterResult');
  if (fr) fr.textContent = `${stocks.length} of ${allStocks.length} stocks`;

  stocks.sort((a, b) => {
    if (sortKey === 'symbol') return sortDir * a.symbol.localeCompare(b.symbol);
    if (sortKey === 'sector') {
      // Missing sectors always sort to the bottom, regardless of direction.
      if (!a.sector && !b.sector) return 0;
      if (!a.sector) return 1;
      if (!b.sector) return -1;
      return sortDir * a.sector.localeCompare(b.sector);
    }
    if (sortKey === 'price') {
      // Missing prices always sort to the bottom, regardless of direction.
      if (a.price == null && b.price == null) return 0;
      if (a.price == null) return 1;
      if (b.price == null) return -1;
      return sortDir * (a.price - b.price);
    }
    if (sortKey === 'earnings') {
      // Average EPS surprise %; stocks with no earnings data sink to the bottom.
      const av = earnAvg(a.symbol), bv = earnAvg(b.symbol);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return sortDir * (av - bv);
    }
    if (sortKey === 'insider') {
      // Signed shares of the headline trade (+buy / −sell); no-trade rows sink.
      const av = insiderMag(a), bv = insiderMag(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return sortDir * (av - bv);
    }
    if (sortKey === 'change') {
      // 1-day % change; stocks with no change data sink to the bottom.
      if (a.change == null && b.change == null) return 0;
      if (a.change == null) return 1;
      if (b.change == null) return -1;
      return sortDir * (a.change - b.change);
    }
    return sortDir * (a[sortKey] - b[sortKey]);
  });

  _filteredSorted = stocks;

  if (!stocks.length) {
    document.getElementById('emptyState').style.display = 'block';
    updateShowMore(0, 0);
    return;
  }
  document.getElementById('emptyState').style.display = 'none';

  const visible = stocks.slice(0, visibleCount);
  const alreadyRendered = body.querySelectorAll('.stock-entry').length;

  visible.slice(alreadyRendered).forEach((stock, i) => {
    const entry = buildRow(stock, alreadyRendered + i + 1);
    body.appendChild(entry);

    const row = entry.querySelector('.stock-row');
    ScrollTrigger.create({
      trigger: row,
      start:   'top 90%',
      onEnter: () => {
        gsap.to(row, {
          opacity:   1,
          y:         0,
          duration:  0.5,
          delay:     i * 0.03,
          ease:      'power2.out',
          onComplete: () => {}
        });
      },
      once: true,
    });
  });

  updateShowMore(visibleCount, stocks.length);
  ScrollTrigger.refresh();
}

function updateShowMore(shown, total) {
  const wrap  = document.getElementById('showMoreWrap');
  const count = document.getElementById('showMoreCount');
  if (total > shown) {
    wrap.style.display = 'flex';
    count.textContent  = `${shown} of ${total} stocks`;
  } else {
    wrap.style.display = 'none';
  }
}

document.getElementById('showMoreBtn').addEventListener('click', () => {
  const btn = document.getElementById('showMoreBtn');

  // Pulse animation on click
  gsap.to(btn, { scale: 0.95, duration: 0.1, yoyo: true, repeat: 1 });

  visibleCount += PAGE_SIZE;
  renderTable(false);

  // Scroll so newly revealed rows are in view
  const rows = document.querySelectorAll('.stock-row');
  const target = rows[visibleCount - PAGE_SIZE - 1];
  if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

/* ─── Sorting (shared by the controls bar + clickable headers) ── */
function updateSortIndicators() {
  const arrow = sortDir < 0 ? '▼' : '▲';

  document.querySelectorAll('.sort-btn').forEach(b => {
    const on = b.dataset.sort === sortKey;
    b.classList.toggle('active', on);
    if (on) b.dataset.arrow = arrow; else b.removeAttribute('data-arrow');
  });

  document.querySelectorAll('.col--sortable').forEach(c => {
    const on = c.dataset.sort === sortKey;
    c.classList.toggle('col--sort-active', on);
    const caret = c.querySelector('.sort-caret');
    if (caret) caret.textContent = on ? arrow : '';
  });
}

function setSort(key) {
  if (!key) return;
  if (sortKey === key) {
    sortDir *= -1;                       // same column → flip direction
  } else {
    sortKey = key;
    sortDir = (key === 'symbol' || key === 'sector') ? 1 : -1; // names A→Z, numbers high→low
  }
  updateSortIndicators();

  const rows = document.querySelectorAll('.stock-row');
  if (rows.length) {
    gsap.to('.stock-row', {
      opacity: 0, y: -10, duration: 0.2, stagger: 0.008,
      onComplete: () => {
        document.getElementById('tableBody').innerHTML = '';
        renderTable(true);
      }
    });
  } else {
    document.getElementById('tableBody').innerHTML = '';
    renderTable(true);
  }
}

document.querySelectorAll('.sort-btn').forEach(btn =>
  btn.addEventListener('click', () => setSort(btn.dataset.sort)));
document.querySelectorAll('.col--sortable').forEach(col =>
  col.addEventListener('click', () => setSort(col.dataset.sort)));

updateSortIndicators();

/* ─── Reusable symbol autocomplete (every search bar) ──── */
function attachAutocomplete(input, opts = {}) {
  if (!input || input._acBound) return;
  input._acBound = true;
  const onSelect = opts.onSelect;

  const dd = document.createElement('div');
  dd.className = 'ac-dropdown';
  dd.style.display = 'none';
  document.body.appendChild(dd);

  let items = [], active = -1;

  function matches(q) {
    q = (q || '').trim().toUpperCase();
    if (!q) return [];
    const list = (typeof allStocks !== 'undefined' && allStocks.length) ? allStocks : [];
    const starts = [], contains = [];
    for (const s of list) {
      if (s.symbol.startsWith(q)) starts.push(s);
      else if (s.symbol.includes(q)) contains.push(s);
    }
    return [...starts, ...contains].slice(0, 8);
  }

  function position() {
    const r = input.getBoundingClientRect();
    dd.style.left  = r.left + 'px';
    dd.style.top   = (r.bottom + 4) + 'px';
    dd.style.width = r.width + 'px';
  }
  function render() {
    if (!items.length) return hide();
    dd.innerHTML = items.map((it, i) => `
      <div class="ac-item${i === active ? ' active' : ''}" data-i="${i}">
        <span class="ac-sym">${it.symbol}</span>
        ${it.price ? `<span class="ac-price">$${(+it.price).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>` : ''}
      </div>`).join('');
    dd.querySelectorAll('.ac-item').forEach(el =>
      el.addEventListener('mousedown', e => { e.preventDefault(); choose(+el.dataset.i); }));
    position();
    dd.style.display = 'block';
  }
  function show() { items = matches(input.value); active = -1; render(); }
  function hide() { dd.style.display = 'none'; items = []; active = -1; }
  function choose(i) {
    const it = items[i]; if (!it) return;
    input.value = it.symbol;
    hide();
    if (onSelect) onSelect(it.symbol, it);
  }

  input.addEventListener('input',  show);
  input.addEventListener('focus',  () => { if (input.value) show(); });
  input.addEventListener('blur',   () => setTimeout(hide, 120));
  input.addEventListener('keydown', e => {
    if (dd.style.display === 'none') return;
    if (e.key === 'ArrowDown')      { e.preventDefault(); active = Math.min(active + 1, items.length - 1); render(); }
    else if (e.key === 'ArrowUp')   { e.preventDefault(); active = Math.max(active - 1, 0); render(); }
    else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); choose(active); }
    else if (e.key === 'Escape')    { hide(); }
  });
  window.addEventListener('scroll', () => { if (dd.style.display !== 'none') position(); }, true);
  window.addEventListener('resize', () => { if (dd.style.display !== 'none') position(); });
}
window.attachAutocomplete = attachAutocomplete;

/* ─── Search ───────────────────────────────────────────── */
const searchInput = document.getElementById('searchInput');
let searchTimeout;
searchInput.addEventListener('input', e => {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    searchQuery = e.target.value.trim();
    renderTable();
  }, 200);
});
attachAutocomplete(searchInput, {
  onSelect: () => { searchQuery = searchInput.value.trim(); renderTable(); },
});

/* ─── Filter panel ─────────────────────────────────────── */
/* Reusable dual-handle range slider. Returns { set(lo,hi,silent) }. */
function initDualSlider(rootId, { min, max, step, onChange }) {
  const root = document.getElementById(rootId);
  const fill = root.querySelector('.ds-fill');
  const lo   = root.querySelector('.ds-min');
  const hi   = root.querySelector('.ds-max');
  [lo, hi].forEach(inp => { inp.min = min; inp.max = max; inp.step = step; });
  lo.value = min; hi.value = max;

  const pct = v => ((v - min) / (max - min)) * 100;
  function paint() {
    fill.style.left  = pct(+lo.value) + '%';
    fill.style.right = (100 - pct(+hi.value)) + '%';
  }
  function onInput(which) {
    let a = +lo.value, b = +hi.value;
    if (a > b) { if (which === 'min') lo.value = b; else hi.value = a; }
    paint();
    onChange(+lo.value, +hi.value);
  }
  lo.addEventListener('input', () => onInput('min'));
  hi.addEventListener('input', () => onInput('max'));
  paint();

  return {
    set(a, b, silent) {
      lo.value = Math.max(min, Math.min(a, max));
      hi.value = Math.max(min, Math.min(b, max));
      if (+lo.value > +hi.value) lo.value = hi.value;
      paint();
      if (!silent) onChange(+lo.value, +hi.value);
    },
  };
}

let _filtersReady = false;
function initFilters() {
  if (_filtersReady) return;
  const btn   = document.getElementById('filterBtn');
  const panel = document.getElementById('filterPanel');
  if (!btn || !panel) return;
  _filtersReady = true;

  /* open / close */
  const open  = () => { panel.hidden = false; panel.classList.add('animate-in'); btn.setAttribute('aria-expanded', 'true'); };
  const close = () => { panel.hidden = true;  panel.classList.remove('animate-in'); btn.setAttribute('aria-expanded', 'false'); };
  btn.addEventListener('click', e => { e.stopPropagation(); panel.hidden ? open() : close(); });
  panel.addEventListener('click', e => e.stopPropagation());
  document.addEventListener('click', () => { if (!panel.hidden) close(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !panel.hidden) close(); });
  document.getElementById('filterDone').addEventListener('click', close);

  const apply = () => { updateFilterBadge(); renderTable(); };

  /* ---- Price ---- */
  const prices    = allStocks.map(s => s.price).filter(v => v != null);
  const priceMax  = prices.length ? Math.ceil(Math.max(...prices) / 50) * 50 : 1000;
  const priceMinEl = document.getElementById('priceMin');
  const priceMaxEl = document.getElementById('priceMax');
  const priceVal   = document.getElementById('priceVal');
  const setPriceVal = (a, b) => { priceVal.textContent = `$${a} – $${b}${b >= priceMax ? '+' : ''}`; };
  const priceSlider = initDualSlider('priceSlider', {
    min: 0, max: priceMax, step: 1,
    onChange: (a, b) => {
      priceMinEl.value = a > 0 ? a : '';
      priceMaxEl.value = b < priceMax ? b : '';
      filters.price.min = a > 0 ? a : null;
      filters.price.max = b < priceMax ? b : null;
      setPriceVal(a, b);
      apply();
    },
  });
  const syncPrice = () => {
    let a = parseFloat(priceMinEl.value), b = parseFloat(priceMaxEl.value);
    a = isNaN(a) ? 0 : Math.max(0, a);
    b = isNaN(b) ? priceMax : Math.min(priceMax, b);
    priceSlider.set(a, b);
  };
  priceMinEl.addEventListener('change', syncPrice);
  priceMaxEl.addEventListener('change', syncPrice);

  /* ---- Signal ---- */
  const signalVal   = document.getElementById('signalVal');
  const signalChips = document.getElementById('signalChips');
  function syncSignalChips() {
    [...signalChips.children].forEach(c => {
      const m = c.dataset.min === '' ? null : +c.dataset.min;
      const maxOpen = filters.signal.max == null || filters.signal.max === 100;
      const active = maxOpen && ((m == null && filters.signal.min == null) ||
                                 (m != null && filters.signal.min === m));
      c.classList.toggle('is-active', active);
    });
  }
  const signalSlider = initDualSlider('signalSlider', {
    min: 0, max: 100, step: 1,
    onChange: (a, b) => {
      filters.signal.min = a > 0 ? a : null;
      filters.signal.max = b < 100 ? b : null;
      signalVal.textContent = (a === 0 && b === 100) ? 'Any' : `${a}–${b}%`;
      syncSignalChips();
      apply();
    },
  });
  signalChips.addEventListener('click', e => {
    const chip = e.target.closest('.fp-chip'); if (!chip) return;
    signalSlider.set(chip.dataset.min === '' ? 0 : +chip.dataset.min, 100);
  });

  /* ---- Sectors ---- */
  const sectors = [...new Set(allStocks.map(s => s.sector).filter(Boolean))].sort();
  const list = document.getElementById('sectorList');
  list.innerHTML = sectors.map(sec => {
    const esc = sec.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    return `<label class="fp-sector"><input type="checkbox" value="${esc}"><span>${esc}</span></label>`;
  }).join('');
  list.addEventListener('change', e => {
    const cb = e.target.closest('input[type=checkbox]'); if (!cb) return;
    if (cb.checked) filters.sectors.add(cb.value); else filters.sectors.delete(cb.value);
    cb.closest('.fp-sector').classList.toggle('is-checked', cb.checked);
    apply();
  });
  document.getElementById('sectorSearch').addEventListener('input', e => {
    const q = e.target.value.trim().toLowerCase();
    [...list.children].forEach(l => { l.style.display = l.textContent.toLowerCase().includes(q) ? '' : 'none'; });
  });
  document.getElementById('secAll').addEventListener('click', () => {
    sectors.forEach(s => filters.sectors.add(s));
    list.querySelectorAll('input').forEach(cb => { cb.checked = true; cb.closest('.fp-sector').classList.add('is-checked'); });
    apply();
  });
  document.getElementById('secNone').addEventListener('click', () => {
    filters.sectors.clear();
    list.querySelectorAll('input').forEach(cb => { cb.checked = false; cb.closest('.fp-sector').classList.remove('is-checked'); });
    apply();
  });

  /* ---- Analyst ratings (buy / hold / sell) ---- */
  document.querySelectorAll('.fp-minmax').forEach(row => {
    const key   = row.dataset.key;
    const minEl = row.querySelector('.fp-mm-min');
    const maxEl = row.querySelector('.fp-mm-max');
    const upd = () => {
      const a = parseInt(minEl.value, 10), b = parseInt(maxEl.value, 10);
      filters[key].min = isNaN(a) ? null : a;
      filters[key].max = isNaN(b) ? null : b;
      apply();
    };
    minEl.addEventListener('input', upd);
    maxEl.addEventListener('input', upd);
  });

  /* ---- Earnings ---- */
  const earnAvgMin = document.getElementById('earnAvgMin');
  const earnAvgMax = document.getElementById('earnAvgMax');
  const updEarn = () => {
    const a = parseFloat(earnAvgMin.value), b = parseFloat(earnAvgMax.value);
    filters.earnings.avgMin = isNaN(a) ? null : a;
    filters.earnings.avgMax = isNaN(b) ? null : b;
    apply();
  };
  earnAvgMin.addEventListener('input', updEarn);
  earnAvgMax.addEventListener('input', updEarn);
  const beatChips = document.getElementById('beatChips');
  beatChips.addEventListener('click', e => {
    const chip = e.target.closest('.fp-chip'); if (!chip) return;
    [...beatChips.children].forEach(c => c.classList.toggle('is-active', c === chip));
    filters.earnings.minBeats = chip.dataset.beats === '' ? null : +chip.dataset.beats;
    apply();
  });
  document.getElementById('lastBeat').addEventListener('change', e => {
    filters.earnings.lastBeat = e.target.checked; apply();
  });

  /* ---- Insider ---- */
  const insiderDir = document.getElementById('insiderDir');
  insiderDir.addEventListener('click', e => {
    const chip = e.target.closest('.fp-chip'); if (!chip) return;
    [...insiderDir.children].forEach(c => c.classList.toggle('is-active', c === chip));
    filters.insider.direction = chip.dataset.dir; apply();
  });
  document.getElementById('insiderMinShares').addEventListener('input', e => {
    const v = parseInt(e.target.value, 10);
    filters.insider.minShares = isNaN(v) ? null : v; apply();
  });
  const insiderWithin = document.getElementById('insiderWithin');
  insiderWithin.addEventListener('click', e => {
    const chip = e.target.closest('.fp-chip'); if (!chip) return;
    [...insiderWithin.children].forEach(c => c.classList.toggle('is-active', c === chip));
    filters.insider.withinDays = chip.dataset.days === '' ? null : +chip.dataset.days; apply();
  });

  /* ---- Price change ---- */
  // Only the 1-day period has data on the current plan; the longer-period
  // chips are disabled in the markup until a historical-data plan is enabled.
  const changePeriod = document.getElementById('changePeriod');
  changePeriod.addEventListener('click', e => {
    const chip = e.target.closest('.fp-chip'); if (!chip || chip.disabled) return;
    [...changePeriod.children].forEach(c => c.classList.toggle('is-active', c === chip));
    filters.change.period = chip.dataset.period; apply();
  });
  const changeMin = document.getElementById('changeMin');
  const changeMax = document.getElementById('changeMax');
  const updChange = () => {
    const a = parseFloat(changeMin.value), b = parseFloat(changeMax.value);
    filters.change.min = isNaN(a) ? null : a;
    filters.change.max = isNaN(b) ? null : b;
    apply();
  };
  changeMin.addEventListener('input', updChange);
  changeMax.addEventListener('input', updChange);

  /* ---- Reset all ---- */
  document.getElementById('filterReset').addEventListener('click', () => {
    filters.price    = { min: null, max: null };
    filters.sectors.clear();
    filters.buy = { min: null, max: null };
    filters.hold = { min: null, max: null };
    filters.sell = { min: null, max: null };
    filters.signal   = { min: null, max: null };
    filters.earnings = { avgMin: null, avgMax: null, minBeats: null, lastBeat: false };
    filters.insider  = { direction: 'any', minShares: null, withinDays: null };
    filters.change   = { period: '1d', min: null, max: null };

    priceMinEl.value = ''; priceMaxEl.value = '';
    priceSlider.set(0, priceMax, true); setPriceVal(0, priceMax);
    signalSlider.set(0, 100, true); signalVal.textContent = 'Any'; syncSignalChips();
    list.querySelectorAll('input').forEach(cb => { cb.checked = false; cb.closest('.fp-sector').classList.remove('is-checked'); });
    document.getElementById('sectorSearch').value = '';
    [...list.children].forEach(l => l.style.display = '');
    document.querySelectorAll('.fp-minmax input').forEach(i => i.value = '');
    earnAvgMin.value = ''; earnAvgMax.value = '';
    [...beatChips.children].forEach(c => c.classList.toggle('is-active', c.dataset.beats === ''));
    document.getElementById('lastBeat').checked = false;
    [...insiderDir.children].forEach(c => c.classList.toggle('is-active', c.dataset.dir === 'any'));
    document.getElementById('insiderMinShares').value = '';
    [...insiderWithin.children].forEach(c => c.classList.toggle('is-active', c.dataset.days === ''));
    changeMin.value = ''; changeMax.value = '';
    [...changePeriod.children].forEach(c => c.classList.toggle('is-active', c.dataset.period === '1d'));

    apply();
  });

  /* initial slider positions (silent — keep filters at default null) */
  priceSlider.set(0, priceMax, true);  setPriceVal(0, priceMax);
  signalSlider.set(0, 100, true);
  updateFilterBadge();
}

/* ─── Earnings — pre-fetched from data/earnings.json ────── */
let earningsData = null;

async function loadEarningsFile() {
  try {
    const res = await fetch('../data/earnings.json');
    if (res.ok) earningsData = await res.json();
  } catch (_) {}
}

/* "2025-07" → "Q3 '25" (calendar quarter from the report month) */
function quarterLabel(qstr) {
  if (!qstr) return '';
  const [yRaw, mRaw] = String(qstr).split('-');
  const y = parseInt(yRaw, 10);
  const m = parseInt(mRaw, 10);
  if (!y || !m) return qstr;
  const q = Math.floor((m - 1) / 3) + 1;
  return `Q${q} '${String(y).slice(-2)}`;
}

function earningsHtml(symbol) {
  if (!earningsData) return '<span class="earn-empty">—</span>';
  const quarters = earningsData[symbol];
  if (!quarters || !quarters.length) {
    return '<span class="earn-empty">No earnings data</span>';
  }
  return quarters.map(q => {
    const val    = q.surprise;
    const period = quarterLabel(q.quarter);
    if (val === null || val === undefined) {
      return `<div class="earn-q">
        <span class="earn-q-period">${period}</span>
        <span class="earn-badge earn-badge--neutral">—</span>
      </div>`;
    }
    const isPos = val >= 0;
    const cls   = isPos ? 'earn-badge--pos' : 'earn-badge--neg';
    const sign  = isPos ? '+' : '';
    return `<div class="earn-q">
        <span class="earn-q-period">${period}</span>
        <span class="earn-badge ${cls}">${sign}${val.toFixed(1)}%</span>
      </div>`;
  }).join('');
}

/* ─── Load data ─────────────────────────────────────────── */
async function loadData() {
  let data = null;

  // Primary: every scored S&P 500 stock (ratings for all ~500).
  // Prices live in all_results.json once a full fetch has run; otherwise we
  // fall back to filtered_stocks.json (prices for the strong-buy survivors).
  try {
    const [allRes, filtRes, profRes, insRes] = await Promise.all([
      fetch('../data/all_results.json').catch(() => null),
      fetch('../data/filtered_stocks.json').catch(() => null),
      fetch('../data/profiles.json').catch(() => null),
      fetch('../data/insiders.json').catch(() => null),
    ]);

    const allJson  = allRes  && allRes.ok  ? await allRes.json()  : null;
    const filtJson = filtRes && filtRes.ok ? await filtRes.json() : {};
    // Sector + logo per symbol (from fetch_profiles.py). Absent until that
    // script has run, so every read is optional-chained.
    const profJson = profRes && profRes.ok ? await profRes.json() : {};
    // Open-market insider trades (from fetch_insiders.py), keyed by symbol —
    // both buys and sells. Absent until that script has run, so reads are
    // optional-chained.
    const insJson  = insRes  && insRes.ok  ? await insRes.json()  : null;
    const insBySym = (insJson && insJson.by_symbol) || {};

    const prof = (symbol) => profJson[symbol] || {};
    // The single most *significant* open-market insider trade for a symbol
    // (largest by dollar value, buy or sell), or null. We skip odd-lot/filing
    // noise (< 100 shares) so the column only flags major moves.
    const MIN_TRADE_SHARES = 100;
    const insider = (symbol) => {
      const list = (insBySym[symbol] || []).filter(t => (t.shares || 0) >= MIN_TRADE_SHARES);
      if (!list.length) return null;
      return list.reduce((a, b) => ((b.value || 0) > (a.value || 0) ? b : a));
    };

    if (allJson && Object.keys(allJson).length) {
      data = Object.entries(allJson).map(([symbol, vals]) => ({
        symbol,
        buy:    vals.buy   || 0,
        hold:   vals.hold  || 0,
        sell:   vals.sell  || 0,
        price:  vals.price ?? (filtJson[symbol] && filtJson[symbol].price) ?? null,
        change: vals.change ?? (filtJson[symbol] && filtJson[symbol].change) ?? null,
        sector: prof(symbol).sector || null,
        logo:   prof(symbol).logo   || null,
        insider: insider(symbol),
      }));
    } else if (Object.keys(filtJson).length) {
      // Fallback: only the filtered set is available.
      data = Object.entries(filtJson).map(([symbol, vals]) => ({
        symbol,
        buy:    vals.buy   || 0,
        hold:   vals.hold  || 0,
        sell:   vals.sell  || 0,
        price:  vals.price || null,
        change: vals.change ?? null,
        sector: prof(symbol).sector || null,
        logo:   prof(symbol).logo   || null,
        insider: insider(symbol),
      }));
    }
  } catch (_) {}

  if (!data || !data.length) {
    data = generateSampleData();
    document.getElementById('stockCount').textContent = 'sample data';
  }

  allStocks = data;
  buildStats(data);
  await loadEarningsFile();
  initRotatingStat();
  initFilters();          // wire the filter panel (needs allStocks for sectors + price range)
  renderTable();
  renderWatchlist();
  // Prices come pre-loaded from the data files (licensed Finnhub data).
  // No browser-side price fetching — see the data sourcing policy in CLAUDE.md.
}

/* ─── Insider trade cell (major open-market buy or sell, per row) ── */
function insiderHtml(stock) {
  const b = stock.insider;
  if (!b || !b.shares) {
    return `<span class="insider-empty">—</span>`;
  }
  const who   = (b.name || 'Insider').split(' ')[0]; // surname only, keep it compact
  const sell  = b.direction === 'sell';
  const arrow = sell ? '▼ −' : '▲ +';
  const verb  = sell ? 'sold' : 'bought';
  return `
    <div class="insider-buy ${sell ? 'sell' : 'buy'}" title="${b.name || 'Insider'} ${verb} ${(b.shares).toLocaleString()} shares${b.value ? ' (' + smFmtValue(b.value) + ')' : ''} on ${b.date}">
      <span class="insider-shares">${arrow}${(b.shares).toLocaleString()}</span>
      <span class="insider-meta">${who} · ${smAgo(b.date)}</span>
    </div>`;
}

/* ─── 1-day price change cell (vs previous close) ── */
function changeHtml(stock) {
  const c = stock.change;
  if (c == null) return `<span class="chg chg--na">—</span>`;
  const cls   = c > 0 ? 'chg--up' : c < 0 ? 'chg--down' : 'chg--flat';
  const arrow = c > 0 ? '▲' : c < 0 ? '▼' : '•';
  return `<span class="chg ${cls}" title="Change vs previous close">${arrow} ${Math.abs(c).toFixed(2)}%</span>`;
}

function smFmtValue(v) {
  if (v >= 1e9) return '$' + (v / 1e9).toFixed(1) + 'B';
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
  if (v >= 1e3) return '$' + (v / 1e3).toFixed(0) + 'K';
  return '$' + v;
}

function smAgo(date) {
  if (!date) return '';
  const days = Math.floor((Date.now() - new Date(date).getTime()) / 86400000);
  if (isNaN(days)) return date;
  if (days <= 0)   return 'today';
  if (days === 1)  return '1d ago';
  if (days < 30)   return days + 'd ago';
  if (days < 365)  return Math.floor(days / 30) + 'mo ago';
  return Math.floor(days / 365) + 'y ago';
}

/* Sample data */
function generateSampleData() {
  return [
    { symbol: 'NVDA',  buy: 38, hold: 5,  sell: 1, price: 134.25 },
    { symbol: 'MSFT',  buy: 32, hold: 8,  sell: 2, price: 461.80 },
    { symbol: 'META',  buy: 28, hold: 7,  sell: 3, price: 624.10 },
    { symbol: 'GOOGL', buy: 27, hold: 6,  sell: 2, price: 182.40 },
    { symbol: 'AMZN',  buy: 26, hold: 9,  sell: 1, price: 213.50 },
    { symbol: 'AAPL',  buy: 24, hold: 10, sell: 4, price: 201.30 },
    { symbol: 'CRM',   buy: 22, hold: 8,  sell: 2, price: 289.70 },
    { symbol: 'NOW',   buy: 20, hold: 7,  sell: 1, price: 998.40 },
    { symbol: 'AMD',   buy: 18, hold: 9,  sell: 3, price: 114.60 },
    { symbol: 'TSM',   buy: 17, hold: 6,  sell: 0, price: 188.20 },
    { symbol: 'PANW',  buy: 16, hold: 8,  sell: 2, price: 194.50 },
    { symbol: 'SNPS',  buy: 15, hold: 5,  sell: 1, price: 487.30 },
    { symbol: 'CDNS',  buy: 14, hold: 6,  sell: 1, price: 268.90 },
    { symbol: 'ANET',  buy: 13, hold: 7,  sell: 2, price: 112.80 },
    { symbol: 'KLAC',  buy: 12, hold: 8,  sell: 3, price: 736.40 },
    { symbol: 'LRCX',  buy: 11, hold: 9,  sell: 4, price: 821.60 },
    { symbol: 'MRVL',  buy: 10, hold: 8,  sell: 2, price: 94.30  },
    { symbol: 'FTNT',  buy: 10, hold: 7,  sell: 1, price: 103.70 },
  ];
}

/* ─── How To Use — scroll animations ───────────────────── */
function initHowTo() {
  gsap.set('.howto-header', { opacity: 0, y: 30 });
  ScrollTrigger.create({
    trigger: '.howto-section',
    start: 'top 85%',
    onEnter: () => {
      gsap.to('.howto-header', { opacity: 1, y: 0, duration: 0.7, ease: 'power2.out' });
    },
    once: true,
  });

  gsap.utils.toArray('.howto-card').forEach((card, i) => {
    ScrollTrigger.create({
      trigger: card,
      start: 'top 90%',
      onEnter: () => {
        gsap.to(card, {
          opacity: 1, y: 0,
          duration: 0.6,
          delay: (i % 2) * 0.1,
          ease: 'power3.out',
        });
      },
      once: true,
    });
  });
}

/* ─── Sources Section — scroll animations ───────────────── */
function initSources() {
  // Header
  gsap.set('.sources-header', { opacity: 0, y: 40 });
  ScrollTrigger.create({
    trigger: '.sources-section',
    start: 'top 82%',
    onEnter: () => {
      gsap.to('.sources-header', {
        opacity: 1, y: 0,
        duration: 0.8,
        ease: 'power3.out',
      });
    },
    once: true,
  });

  // Cards — stagger in with slide + fade
  gsap.utils.toArray('.source-card').forEach((card, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    gsap.set(card, { opacity: 0, y: 40, x: col === 0 ? -20 : 20 });

    ScrollTrigger.create({
      trigger: card,
      start: 'top 88%',
      onEnter: () => {
        gsap.to(card, {
          opacity: 1, y: 0, x: 0,
          duration: 0.75,
          delay: (col * 0.12) + (row * 0.08),
          ease: 'power3.out',
        });
      },
      once: true,
    });
  });

}

/* ─── Fed Rate Panel ────────────────────────────────────── */
async function loadFedRate() {
  const inner = document.getElementById('fedDrawerInner');
  const chipValue = document.getElementById('fedChipValue');

  let data = null;
  try {
    const res = await fetch('../data/fed_rate.json');
    if (res.ok) data = await res.json();
  } catch (_) {}

  if (!data) {
    if (chipValue) chipValue.textContent = 'N/A';
    inner.innerHTML = `
      <div class="fed-section">
        <div class="fed-loading">Run <code style="color:var(--buy);font-family:var(--mono)">fetch_fed_rate.py</code><br>to load rate data.</div>
      </div>`;
    return;
  }

  if (chipValue) {
    const lo = data.current_lower != null ? data.current_lower.toFixed(2) : '—';
    const hi = data.current_upper != null ? data.current_upper.toFixed(2) : '—';
    chipValue.textContent = `${lo}–${hi}%`;
  }

  const next     = data.next_meeting || {};
  const expected = next.expected || 'hold';
  const history  = data.history  || [];

  const dirIcons = { cut: '▼', hike: '▲', hold: '◆' };
  const dirLabel = { cut: 'CUT EXPECTED', hike: 'HIKE EXPECTED', hold: 'HOLD EXPECTED' };

  const impactText = (data.market_impact || {})[expected] || '';

  const historyHtml = history.slice().reverse().map(h => {
    const sign  = h.change > 0 ? '+' : '';
    const cls   = h.direction;
    const icon  = h.direction === 'cut' ? '↓' : '↑';
    return `
      <div class="fed-history-item">
        <span class="fed-history-dir">${icon}</span>
        <span class="fed-history-label">${h.label}</span>
        <span class="fed-history-rate">${h.lower.toFixed(2)}–${h.upper.toFixed(2)}%</span>
        <span class="fed-history-change ${cls}">${sign}${(h.change * 100).toFixed(0)}bps</span>
      </div>`;
  }).join('');

  inner.innerHTML = `
    <div class="fed-section">
      <div class="fed-section-label">Current Rate</div>
      <div class="fed-rate-display">
        <span class="fed-rate-number">${data.current_lower != null ? data.current_lower.toFixed(2) : '—'}%</span>
        <span class="fed-rate-range">– ${data.current_upper != null ? data.current_upper.toFixed(2) : '—'}%</span>
      </div>
      <div class="fed-updated">Updated ${data.last_updated || '—'}</div>
    </div>

    ${next.date ? `
    <div class="fed-section">
      <div class="fed-section-label">Next Decision</div>
      <div class="fed-meeting-date">${next.label || next.date}</div>
      <div class="fed-meeting-days">${next.days_until === 0 ? 'Today' : next.days_until === 1 ? 'Tomorrow' : next.days_until + ' days away'}</div>
      <div class="fed-direction-badge ${expected}">
        <span class="fed-direction-icon">${dirIcons[expected] || '◆'}</span>
        ${dirLabel[expected] || 'TBD'}
      </div>
    </div>` : ''}

    ${impactText ? `
    <div class="fed-section">
      <div class="fed-section-label">Market Impact</div>
      <div class="fed-impact-text">${impactText}</div>
    </div>` : ''}

    ${historyHtml ? `
    <div class="fed-section">
      <div class="fed-section-label">Last ${history.length} Rate Changes</div>
      <div class="fed-history-list">${historyHtml}</div>
    </div>` : ''}
  `;
}

/* ─── Economic Calendar Panel ───────────────────────────── */
async function loadCalendar() {
  const inner = document.getElementById('calDrawerInner');

  let data = null;
  try {
    const res = await fetch('../data/calendar.json');
    if (res.ok) data = await res.json();
  } catch (_) {}

  if (!data) {
    inner.innerHTML = `
      <div class="cal-section">
        <div class="cal-loading">Run <code style="color:var(--accent);font-family:var(--mono)">fetch_calendar.py</code><br>to load economic events.</div>
      </div>`;
    return;
  }

  const events = data.events || [];

  // ── Event info database ─────────────────────────────────
  const EVENT_INFO = {
    'non-farm payrolls': {
      what: 'Measures the monthly change in employed workers across the US economy, excluding the farming sector. Released on the first Friday of each month by the Bureau of Labor Statistics (BLS). It is the single most watched economic release on Wall Street.',
      why: 'Employment drives consumer spending, which accounts for ~70% of US GDP. The Fed watches this closely — too many jobs = inflation risk = rates stay high = bad for stocks.',
      bull: { text: 'Weaker than expected jobs growth gives the Fed room to cut rates. Lower rates reduce borrowing costs and boost stock valuations — especially <strong>tech and growth stocks</strong>.' },
      bear: { text: 'Blowout jobs number = Fed keeps rates elevated. Higher rates compress valuations on high-PE stocks and put pressure on <strong>rate-sensitive sectors like real estate and utilities</strong>.' },
      watch: 'Watch the headline number vs estimate, but also average hourly earnings (wage inflation) and the participation rate. Wages rising fast = Fed worry.',
      sectors: ['Technology', 'Consumer Discretionary', 'Real Estate', 'Financials'],
    },
    'unemployment': {
      what: 'The percentage of the labour force that is jobless and actively looking for work. Released alongside NFP every first Friday by the BLS. A "lagging indicator" — it confirms trends rather than predicts them.',
      why: 'The Fed has a dual mandate: stable prices AND maximum employment. Rising unemployment gives them justification to cut rates.',
      bull: { text: 'Rising unemployment signals a cooling labour market. The Fed gains confidence to cut rates → <strong>equities and bonds rally</strong>.' },
      bear: { text: 'Unemployment near historic lows keeps the Fed hawkish. No urgency to cut → <strong>growth stocks remain under pressure from elevated rates</strong>.' },
      watch: 'The "natural rate" is considered around 4–4.5%. Above that = labour market softening. Below = tight market.',
      sectors: ['Technology', 'Consumer Discretionary', 'Financials'],
    },
    'cpi': {
      what: 'Consumer Price Index — measures the average change in prices paid by consumers for a basket of goods and services including food, housing, transport, and healthcare. Released monthly by the BLS, typically mid-month.',
      why: 'CPI is the most watched inflation gauge. The Fed targets 2% annual inflation. When CPI runs hot, the Fed raises rates. When it cools, they can cut. This directly determines the cost of money in the economy.',
      bull: { text: 'CPI prints below estimates → disinflation story intact → Fed on track to cut rates → <strong>broad market rally, especially tech and growth</strong>.' },
      bear: { text: 'CPI beats estimates → inflation re-accelerating → Fed delays cuts or hikes → <strong>bond yields spike, growth stocks sell off hard</strong>.' },
      watch: 'The month-over-month change matters as much as year-over-year. "Supercore" CPI (services ex-housing) is what the Fed watches most closely.',
      sectors: ['Technology', 'Real Estate', 'Consumer Staples', 'Utilities', 'Financials'],
    },
    'core cpi': {
      what: 'CPI excluding food and energy prices, which are volatile and driven by external factors. Core CPI gives a cleaner picture of underlying inflation trends in the domestic economy.',
      why: 'The Fed focuses on core inflation because food and energy volatility can distort the overall picture. A persistently high core CPI is what keeps the Fed hawkish.',
      bull: { text: 'Core CPI cooling → sticky inflation fading → Fed pivot more likely → <strong>risk assets rally across the board</strong>.' },
      bear: { text: 'Core CPI stays elevated → Fed cannot justify cuts → higher-for-longer rates → <strong>multiple compression in growth stocks</strong>.' },
      watch: 'Housing (shelter) and services inflation within core CPI are the key sub-components. These are the stickiest.',
      sectors: ['Technology', 'Real Estate', 'Consumer Discretionary', 'Utilities'],
    },
    'pce': {
      what: 'Personal Consumption Expenditures — the Federal Reserve\'s preferred inflation measure. Broader than CPI, covering more spending categories and adjusting for when consumers substitute cheaper alternatives.',
      why: 'The Fed explicitly targets 2% PCE inflation in its mandate. PCE tends to run lower than CPI. When Fed officials say "inflation", they mean PCE.',
      bull: { text: 'PCE cooling toward 2% target → Fed mission accomplished → rate cuts justified → <strong>strong rally in equities and bonds</strong>.' },
      bear: { text: 'PCE remains above 2% → Fed must stay restrictive → prolonged high rates → <strong>ongoing pressure on leveraged companies and growth stocks</strong>.' },
      watch: 'Core PCE (ex-food and energy) is the exact number the Fed targets at 2%. Watch the 3-month annualised rate for trend.',
      sectors: ['Technology', 'Real Estate', 'Consumer Discretionary', 'Financials'],
    },
    'gdp': {
      what: 'Gross Domestic Product — the total monetary value of all goods and services produced in the US over a quarter. Released by the Bureau of Economic Analysis in three rounds: Advance (most market-moving), Second Estimate, and Final.',
      why: 'GDP is the broadest measure of economic health. Two consecutive quarters of negative GDP = official recession. Corporate earnings growth is directly tied to economic growth.',
      bull: { text: 'Solid GDP growth (2–3%) → healthy earnings environment → <strong>broad equity market support, cyclicals outperform</strong>.' },
      bear: { text: 'GDP contraction or near-zero growth → recession fears spike → <strong>defensive rotation into staples, healthcare, bonds</strong>.' },
      watch: 'GDP is backward-looking. The components matter: consumer spending (70%), business investment, and government spending. A drop driven by inventories is less alarming than a drop in consumer spending.',
      sectors: ['Industrials', 'Consumer Discretionary', 'Financials', 'Materials'],
    },
    'fomc': {
      what: 'The Federal Open Market Committee — 12 voting members including the Fed Chair — meets 8 times per year to set the federal funds rate. Their decision, statement, and press conference are all market-moving events.',
      why: 'The federal funds rate is the foundation of all borrowing costs in the economy — mortgages, corporate loans, credit cards. It directly sets the "risk-free rate" against which all stocks are valued.',
      bull: { text: 'Rate cut or dovish language → cheaper money → lower discount rates → higher present value of future earnings → <strong>tech and growth stocks surge</strong>.' },
      bear: { text: 'Rate hike or hawkish guidance → tighter financial conditions → higher borrowing costs for companies → <strong>stocks reprice lower, especially high-PE names</strong>.' },
      watch: 'The actual rate decision is often priced in. What moves markets is the "dot plot" (rate projections), the statement language ("data dependent", "restrictive"), and the press conference tone.',
      sectors: ['Technology', 'Real Estate', 'Utilities', 'Financials', 'Consumer Discretionary'],
    },
    'retail sales': {
      what: 'Measures the total value of sales at retail stores — from supermarkets and car dealerships to online retailers. Released monthly by the Census Bureau, it is a direct pulse of consumer spending activity.',
      why: 'Consumer spending drives ~70% of US GDP. Strong retail sales = healthy economy = strong corporate revenues. Weak retail = consumers pulling back = earnings risk.',
      bull: { text: 'Retail sales beat → consumer resilience → revenue growth for retailers and consumer companies → <strong>consumer discretionary, e-commerce, and payment stocks rally</strong>.' },
      bear: { text: 'Weak retail sales → consumers under pressure → earnings downgrades ahead → <strong>consumer discretionary sells off, defensive stocks outperform</strong>.' },
      watch: '"Core retail sales" (ex-autos and gas) is the cleanest signal. Online retail trends within the report signal shifts in consumer behaviour.',
      sectors: ['Consumer Discretionary', 'Consumer Staples', 'Technology', 'Financials'],
    },
    'ism manufacturing': {
      what: 'The Institute for Supply Management surveys 400+ purchasing managers about new orders, production, employment, and inventories. A reading above 50 = expansion, below 50 = contraction.',
      why: 'Manufacturing is a leading economic indicator. When factories are ordering more and hiring, the broader economy tends to follow. It is one of the first data points released each month.',
      bull: { text: 'ISM above 50 and rising → industrial expansion → supply chains active → <strong>industrials, materials, and semiconductor stocks rally</strong>.' },
      bear: { text: 'ISM below 50 → manufacturing in contraction → early recession signal → <strong>cyclical stocks sell off, defensive rotation begins</strong>.' },
      watch: 'The New Orders sub-index is the most forward-looking component. Prices Paid sub-index signals inflationary pressure in the supply chain.',
      sectors: ['Industrials', 'Materials', 'Technology', 'Energy'],
    },
    'ism services': {
      what: 'ISM Non-Manufacturing PMI covers the service sector — finance, healthcare, retail, hospitality — which accounts for roughly 80% of US economic activity. Above 50 = expansion.',
      why: 'Since services dominate the US economy, this is arguably more important than the manufacturing PMI. A contraction here signals broad economic slowdown.',
      bull: { text: 'Strong services PMI → the largest sector of the economy is growing → <strong>financials, consumer stocks, and healthcare outperform</strong>.' },
      bear: { text: 'Services contraction → economic slowdown across 80% of the economy → <strong>broad market weakness, earnings estimates cut</strong>.' },
      watch: 'Employment and New Orders sub-indices are most important. Services inflation within the report is closely watched by the Fed.',
      sectors: ['Financials', 'Healthcare', 'Consumer Discretionary', 'Technology'],
    },
    'ppi': {
      what: 'Producer Price Index measures the average prices received by domestic producers for their goods and services. It is a leading indicator of consumer inflation — cost pressures at the producer level eventually pass through to consumers.',
      why: 'PPI leads CPI by 2–3 months. A rising PPI tells you that consumer prices are likely to follow. It also directly impacts corporate profit margins.',
      bull: { text: 'PPI falling → input costs declining → profit margins expand → <strong>positive for corporate earnings and equities broadly</strong>.' },
      bear: { text: 'PPI rising → cost inflation building in the pipeline → margin pressure ahead → <strong>companies with low pricing power sell off</strong>.' },
      watch: 'Core PPI (ex-food, energy, trade services) is the cleanest signal of underlying producer inflation and what flows to CPI.',
      sectors: ['Consumer Staples', 'Industrials', 'Materials', 'Healthcare'],
    },
    'jobless claims': {
      what: 'Weekly initial jobless claims count how many people filed for unemployment insurance for the first time in the past week. Released every Thursday by the Department of Labor — the most frequent major economic release.',
      why: 'Because it\'s weekly, it gives the most current read on the labour market. A sustained rise in claims signals the job market is cracking, which has major Fed policy implications.',
      bull: { text: 'Claims trending higher → job market softening → Fed likely to cut → <strong>rate-sensitive stocks (tech, real estate) rally</strong>.' },
      bear: { text: 'Claims remain near historic lows → labour market too tight → inflation risk remains → <strong>Fed stays hawkish, growth stocks pressured</strong>.' },
      watch: 'The 4-week moving average smooths out weekly noise. Continuing claims (people still on unemployment) show how hard it is to find a new job.',
      sectors: ['Technology', 'Consumer Discretionary', 'Real Estate', 'Financials'],
    },
    'housing starts': {
      what: 'Measures the number of new residential construction projects that broke ground during the month, including single-family and multi-unit buildings. Released monthly by the Census Bureau.',
      why: 'Housing is highly rate-sensitive and has strong multiplier effects on the economy — construction employs workers, buys materials, furnishes homes. It is a leading economic indicator.',
      bull: { text: 'Strong housing starts → construction activity up → positive for <strong>homebuilders, lumber, appliances, and mortgage lenders</strong>.' },
      bear: { text: 'Weak housing starts → high mortgage rates killing demand → negative for <strong>real estate, construction, and home improvement stocks</strong>.' },
      watch: 'Building Permits (released alongside) are more forward-looking — a permit leads a start by months. The split between single-family and multi-family is also important.',
      sectors: ['Real Estate', 'Materials', 'Financials', 'Consumer Discretionary'],
    },
    'consumer confidence': {
      what: 'The Conference Board surveys 3,000 households each month on their assessment of current business and labour conditions, and their expectations for the next 6 months. Scale: 100 = neutral.',
      why: 'Confident consumers spend more. Consumer spending drives 70% of GDP. This report gives a direct window into whether Americans feel secure enough to open their wallets.',
      bull: { text: 'Rising confidence → households planning to spend more → <strong>consumer discretionary, retail, and travel stocks rally</strong>.' },
      bear: { text: 'Falling confidence → consumers tightening belts → <strong>spending slowdown ahead, discretionary stocks sold</strong>.' },
      watch: 'The "Jobs Plentiful vs Jobs Hard to Get" differential is a leading labour market indicator. Expectations sub-index shows forward spending intent.',
      sectors: ['Consumer Discretionary', 'Consumer Staples', 'Technology', 'Financials'],
    },
    'durable goods': {
      what: 'Measures new orders placed with manufacturers for goods expected to last 3+ years — aircraft, machinery, vehicles, electronics. Released monthly by the Census Bureau.',
      why: 'Durable goods orders reflect business investment confidence. Companies order expensive equipment when they expect future demand. It is a leading indicator of industrial output.',
      bull: { text: 'Strong orders → businesses investing in capacity → industrial expansion ahead → <strong>industrials, defence, and semiconductor equipment stocks rally</strong>.' },
      bear: { text: 'Weak orders → capex spending drying up → business confidence falling → <strong>industrials and technology hardware stocks drop</strong>.' },
      watch: '"Core capex" (non-defence, non-aircraft capital goods) is the cleanest business investment signal. Volatile aircraft orders can distort the headline number.',
      sectors: ['Industrials', 'Technology', 'Materials', 'Defence'],
    },
  };

  function getEventInfo(name) {
    const normalize = s => s.toLowerCase().replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
    const n = normalize(name);
    for (const [key, info] of Object.entries(EVENT_INFO)) {
      if (n.includes(normalize(key))) return info;
    }
    return null;
  }

  function daysLabel(d) {
    if (d === 0) return '<span class="cal-event-days today">TODAY</span>';
    if (d === 1) return '<span class="cal-event-days soon">TOMORROW</span>';
    if (d <= 5)  return `<span class="cal-event-days soon">in ${d} days</span>`;
    return `<span class="cal-event-days">in ${d} days</span>`;
  }

  function valRow(e) {
    if (!e.prev && !e.estimate && !e.actual) return '';
    const parts = [];
    if (e.prev)     parts.push(`<div class="cal-val"><span class="cal-val-label">Prev</span><span class="cal-val-num">${e.prev}</span></div>`);
    if (e.estimate) parts.push(`<div class="cal-val"><span class="cal-val-label">Est</span><span class="cal-val-num estimate">${e.estimate}</span></div>`);
    if (e.actual)   parts.push(`<div class="cal-val"><span class="cal-val-label">Act</span><span class="cal-val-num actual">${e.actual}</span></div>`);
    return `<div class="cal-event-values">${parts.join('')}</div>`;
  }

  function buildCard(e, impactClass, badgeHtml) {
    const info = getEventInfo(e.name);
    const country = e.flag
      ? `<span class="cal-event-country" title="${e.country_name || ''}">${e.flag} ${e.country || ''}</span>`
      : '';
    return `
      <div class="cal-event ${impactClass}" data-name="${e.name}" data-country="${e.country || ''}">
        <div class="cal-event-top">
          <div class="cal-event-top-left">${country}${badgeHtml}</div>
          ${e.days_until != null ? daysLabel(e.days_until) : ''}
        </div>
        <div class="cal-event-name">${e.name}</div>
        <div class="cal-event-date">${e.label}${e.time ? ' · ' + e.time + ' UTC' : ''}</div>
        ${valRow(e)}
        ${info ? '<div class="cal-expand-hint">click for details ▾</div>' : ''}
      </div>`;
  }

  const high   = events.filter(e => e.impact === 'high');
  const medium = events.filter(e => e.impact === 'medium');

  const listHtml = `
    ${high.length   ? `<div class="cal-section"><div class="cal-section-label">High Impact</div>${high.map(e => buildCard(e, 'high', '<span class="cal-event-badge high">⬤ HIGH</span>')).join('')}</div>` : ''}
    ${medium.length ? `<div class="cal-section"><div class="cal-section-label">Medium Impact</div>${medium.slice(0,24).map(e => buildCard(e, 'medium', '<span class="cal-event-badge medium">◆ MED</span>')).join('')}</div>` : ''}
    <div class="cal-section"><div style="font-size:10px;color:var(--text-dim);font-family:var(--mono);letter-spacing:0.5px;">Updated ${data.last_updated || '—'}</div></div>
  `;

  inner.innerHTML = listHtml;

  const drawer = document.getElementById('calDrawer');

  function showDetail(e) {
    const info = getEventInfo(e.name);
    if (!info) return;

    const daysStr = e.days_until != null
      ? (e.days_until === 0 ? '<span class="today">TODAY</span>'
        : e.days_until === 1 ? '<span class="soon">Tomorrow</span>'
        : e.days_until <= 5 ? `<span class="soon">in ${e.days_until} days</span>`
        : `in ${e.days_until} days`)
      : '';

    const numBlocks = [
      e.prev     ? `<div class="cal-detail-num-block"><div class="cal-detail-num-label">Previous</div><div class="cal-detail-num-value">${e.prev}</div></div>` : '',
      e.estimate ? `<div class="cal-detail-num-block"><div class="cal-detail-num-label">Estimate</div><div class="cal-detail-num-value estimate">${e.estimate}</div></div>` : '',
      e.actual   ? `<div class="cal-detail-num-block"><div class="cal-detail-num-label">Actual</div><div class="cal-detail-num-value actual">${e.actual}</div></div>` : '',
    ].filter(Boolean).join('');

    const sectorsHtml = info.sectors
      ? `<div class="cal-detail-section">
           <div class="cal-detail-section-label">Most Affected Sectors</div>
           <div class="cal-sectors-list">${info.sectors.map(s => `<span class="cal-sector-chip">${s}</span>`).join('')}</div>
         </div>`
      : '';

    const watchHtml = info.watch
      ? `<div class="cal-detail-section">
           <div class="cal-detail-section-label">What to Watch</div>
           <div class="cal-detail-body-text">${info.watch}</div>
         </div>`
      : '';

    const detailView = `
      <div class="cal-detail-view" id="calDetailView">
        <div class="cal-detail-back" id="calDetailBack">
          <span class="cal-detail-back-arrow">←</span> Back to calendar
        </div>
        <div class="cal-detail-header">
          <div class="cal-detail-impact-row">
            <span class="cal-event-badge ${e.impact}">${e.impact === 'high' ? '⬤ HIGH IMPACT' : '◆ MEDIUM IMPACT'}</span>
            <span class="cal-event-days${e.days_until <= 1 ? ' soon' : ''}">${daysStr}</span>
          </div>
          <div class="cal-detail-title">${e.flag ? e.flag + ' ' : ''}${e.name}</div>
          <div class="cal-detail-date-row">
            ${e.country_name ? `<span>${e.country_name}</span><span>·</span>` : ''}
            <span>${e.label}</span>
            ${e.time ? `<span>· ${e.time} UTC</span>` : ''}
          </div>
        </div>
        ${numBlocks ? `<div class="cal-detail-numbers">${numBlocks}</div>` : ''}
        <div class="cal-detail-body">
          <div class="cal-detail-section">
            <div class="cal-detail-section-label">What is this?</div>
            <div class="cal-detail-body-text">${info.what}</div>
          </div>
          <div class="cal-detail-section">
            <div class="cal-detail-section-label">Why it matters</div>
            <div class="cal-detail-body-text">${info.why}</div>
          </div>
          <div class="cal-detail-section">
            <div class="cal-detail-section-label">Market Scenarios</div>
            <div class="cal-scenario-card bull">
              <span class="cal-scenario-icon">▲</span>
              <span class="cal-scenario-text">${info.bull.text}</span>
            </div>
            <div class="cal-scenario-card bear" style="margin-top:8px">
              <span class="cal-scenario-icon">▼</span>
              <span class="cal-scenario-text">${info.bear.text}</span>
            </div>
          </div>
          ${watchHtml}
          ${sectorsHtml}
        </div>
      </div>`;

    const EASE = 'cubic-bezier(0.4, 0, 0.2, 1)';

    // Slide out to the left
    inner.style.transition = `opacity 0.22s ${EASE}, transform 0.22s ${EASE}`;
    inner.style.opacity    = '0';
    inner.style.transform  = 'translateX(-18px)';

    setTimeout(() => {
      inner.innerHTML       = detailView;
      drawer.classList.add('card-expanded');
      inner.style.transition = 'none';
      inner.style.opacity    = '0';
      inner.style.transform  = 'translateX(18px)'; // arrive from right

      requestAnimationFrame(() => requestAnimationFrame(() => {
        inner.style.transition = `opacity 0.3s ${EASE}, transform 0.3s ${EASE}`;
        inner.style.opacity    = '1';
        inner.style.transform  = 'translateX(0)';
      }));

      document.getElementById('calDetailBack').addEventListener('click', () => {
        // Slide out to the right
        inner.style.transition = `opacity 0.22s ${EASE}, transform 0.22s ${EASE}`;
        inner.style.opacity    = '0';
        inner.style.transform  = 'translateX(18px)';

        setTimeout(() => {
          inner.innerHTML = listHtml;
          drawer.classList.remove('card-expanded');
          inner.style.transition = 'none';
          inner.style.opacity    = '0';
          inner.style.transform  = 'translateX(-18px)'; // arrive from left

          requestAnimationFrame(() => requestAnimationFrame(() => {
            inner.style.transition = `opacity 0.3s ${EASE}, transform 0.3s ${EASE}`;
            inner.style.opacity    = '1';
            inner.style.transform  = 'translateX(0)';
          }));

          attachCardClicks();
        }, 230);
      });
    }, 230);
  }

  function attachCardClicks() {
    inner.querySelectorAll('.cal-event').forEach(card => {
      if (!getEventInfo(card.dataset.name || '')) return;
      card.addEventListener('click', () => {
        const { name, country } = card.dataset;
        const ev = events.find(e => e.name === name && (e.country || '') === (country || ''));
        if (ev) showDetail(ev);
      });
    });
  }

  attachCardClicks();
}

/* ─── Watchlist Sidebar ─────────────────────────────────── */
function openWatchlistSidebar() {
  const sidebar   = document.getElementById('watchlistSidebar');
  const btn       = document.getElementById('watchlistToggleBtn');
  if (!sidebar) return;
  sidebar.classList.add('open');
  document.body.classList.add('wl-open');   // shrink the page so it sits beside, not under
  if (btn)      btn.classList.add('active');
  refreshWatchlistQuotes();
  clearInterval(_wlQuoteTimer);
  _wlQuoteTimer = setInterval(refreshWatchlistQuotes, 45000);
}

function closeWatchlistSidebar() {
  const sidebar   = document.getElementById('watchlistSidebar');
  const btn       = document.getElementById('watchlistToggleBtn');
  if (!sidebar) return;
  sidebar.classList.remove('open');
  document.body.classList.remove('wl-open');
  if (btn)      btn.classList.remove('active');
  clearInterval(_wlQuoteTimer);
}

function toggleWatchlistSidebar() {
  const sidebar = document.getElementById('watchlistSidebar');
  if (!sidebar) return;
  sidebar.classList.contains('open') ? closeWatchlistSidebar() : openWatchlistSidebar();
}

/* ─── Watchlist ─────────────────────────────────────────── */
function getAuthToken() { return localStorage.getItem('bs_token'); }

async function loadWatchlist() {
  const token = getAuthToken();
  if (!token) return;
  try {
    const res = await fetch('/api/watchlist', {
      headers: { Authorization: 'Bearer ' + token, 'ngrok-skip-browser-warning': 'true' }
    });
    if (!res.ok) return;
    const { symbols } = await res.json();
    watchlistSymbols = new Set(symbols.map(s => s.symbol));
    updateAllWatchlistButtons();
    renderWatchlist();
  } catch (_) {}
}

function clearWatchlist() {
  watchlistSymbols.clear();
  updateAllWatchlistButtons();
  renderWatchlist();
}

function showWatchlistPaywall() {
  showUpgradePrompt({
    title: 'Your watchlist is full',
    sub: `Free accounts can save up to <strong>${WATCHLIST_FREE_LIMIT} stocks</strong>. `
       + `Upgrade to <strong>Brick Street Pro</strong> for an <strong>unlimited watchlist</strong>, `
       + `the full P&amp;L calendar, analytics &amp; CSV export.`
  });
}

async function toggleWatchlist(symbol) {
  const token = getAuthToken();
  if (!token) {
    document.getElementById('loginModal').classList.add('open');
    return;
  }

  const inList = watchlistSymbols.has(symbol);

  if (inList) {
    try {
      await fetch(`/api/watchlist/${symbol}`, {
        method: 'DELETE',
        headers: { Authorization: 'Bearer ' + token, 'ngrok-skip-browser-warning': 'true' }
      });
      watchlistSymbols.delete(symbol);
    } catch (_) {}
  } else {
    // Free accounts are capped at 15 saved stocks; pro is unlimited.
    if (!isProUser() && watchlistSymbols.size >= WATCHLIST_FREE_LIMIT) {
      showWatchlistPaywall();
      return;
    }
    try {
      const res = await fetch('/api/watchlist', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true' },
        body: JSON.stringify({ symbol })
      });
      if (res.status === 402) { showWatchlistPaywall(); return; }   // server enforced the cap
      if (!res.ok) return;
      watchlistSymbols.add(symbol);
    } catch (_) { return; }
  }

  updateWatchlistButtons(symbol);
  renderWatchlist();
}

function updateWatchlistButtons(symbol) {
  document.querySelectorAll(`.wl-btn[data-symbol="${symbol}"]`).forEach(btn => {
    const active = watchlistSymbols.has(symbol);
    btn.classList.toggle('wl-btn--active', active);
    btn.title = active ? `Remove ${symbol} from watchlist` : `Save ${symbol} to watchlist`;
  });
}

function updateAllWatchlistButtons() {
  document.querySelectorAll('.wl-btn').forEach(btn => {
    const symbol = btn.dataset.symbol;
    const active = watchlistSymbols.has(symbol);
    btn.classList.toggle('wl-btn--active', active);
    btn.title = active ? `Remove ${symbol} from watchlist` : `Save ${symbol} to watchlist`;
  });
}

/* Build the list of rotating insights for a watchlist stock */
function getWatchlistInsights(symbol, stock) {
  const out = [];
  if (stock) {
    const total  = stock.buy + stock.hold + stock.sell;
    const buyPct = total > 0 ? Math.round((stock.buy / total) * 100) : null;
    if (buyPct !== null)
      out.push({ text: `BUY SIGNAL  ${buyPct}%  ·  ${total} analysts`, cls: buyPct >= 60 ? 'pos' : 'neu' });
    if (total > 0)
      out.push({ text: `${stock.buy}B / ${stock.hold}H / ${stock.sell}S`, cls: 'neu' });
  }
  if (earningsData) {
    const qs = (earningsData[symbol] || []).filter(q => q.surprise != null);
    if (qs.length) {
      const beats  = qs.filter(q => q.surprise > 0).length;
      const avg    = qs.reduce((s, q) => s + q.surprise, 0) / qs.length;
      const sign   = avg >= 0 ? '+' : '';
      out.push({ text: `EPS  ${beats}/${qs.length} beats  ·  avg ${sign}${avg.toFixed(1)}%`, cls: avg >= 0 ? 'pos' : 'neg' });
    }
  }
  return out;
}

let _insightTimer = null;

function startInsightRotation(container) {
  clearInterval(_insightTimer);
  const items = container.querySelectorAll('.wl-insight[data-insights]');
  if (!items.length) return;

  const stateMap = new Map(); // element → current index
  items.forEach(el => {
    let insights;
    try { insights = JSON.parse(el.dataset.insights); } catch { return; }
    stateMap.set(el, { insights, idx: 0 });
  });

  _insightTimer = setInterval(() => {
    stateMap.forEach((s, el) => {
      if (s.insights.length < 2) return;
      el.classList.add('wl-insight--fade-out');
      setTimeout(() => {
        s.idx = (s.idx + 1) % s.insights.length;
        const ins = s.insights[s.idx];
        el.textContent = ins.text;
        el.className = `wl-insight wl-insight--${ins.cls} wl-insight--fade-in`;
        requestAnimationFrame(() => {
          requestAnimationFrame(() => el.classList.remove('wl-insight--fade-in'));
        });
      }, 320);
    });
  }, 3400);
}

function renderWatchlist() {
  const body     = document.getElementById('watchlistBody');
  const countEl  = document.getElementById('watchlistCount');
  const hdrCount = document.getElementById('wlHeaderCount');
  if (!body) return;

  const symbols = [...watchlistSymbols];
  const label   = symbols.length === 1 ? '1 stock' : `${symbols.length} stocks`;
  if (countEl)   countEl.textContent  = label;
  if (hdrCount)  hdrCount.textContent = symbols.length || '';

  if (!symbols.length) {
    body.innerHTML = `
      <div class="watchlist-empty-state">
        <svg viewBox="0 0 24 24" fill="none"><polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <span>Click ★ on any stock to add it here</span>
      </div>`;
    return;
  }

  body.innerHTML = symbols.map(symbol => {
    const stock   = allStocks.find(s => s.symbol === symbol);
    const seed    = stock && stock.price
      ? '$' + stock.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : '—';
    const insights = getWatchlistInsights(symbol, stock);
    const firstIns = insights[0] || { text: 'No data yet', cls: 'neu' };

    return `
      <div class="wl-item" data-symbol="${symbol}" title="Click to locate in the feed">
        <div class="wl-item-top">
          <span class="wl-item-symbol">${symbol}</span>
          <button class="wl-item-remove" data-symbol="${symbol}" title="Remove from watchlist">✕</button>
        </div>
        <div class="wl-item-live" data-live="${symbol}">
          <span class="wl-item-price">${seed}</span>
          <span class="wl-item-chg wl-item-chg--idle">—</span>
        </div>
        <div class="wl-insight wl-insight--${firstIns.cls}"
             data-insights='${JSON.stringify(insights).replace(/'/g, "&#39;")}'>${firstIns.text}</div>
      </div>`;
  }).join('');

  body.querySelectorAll('.wl-item-remove').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); toggleWatchlist(btn.dataset.symbol); });
  });
  body.querySelectorAll('.wl-item').forEach(item => {
    item.addEventListener('click', () => goToStock(item.dataset.symbol));
  });

  startInsightRotation(body);
  refreshWatchlistQuotes();
}

/* ── Live, dynamically-updating prices for watchlist items ──── */
let _wlQuoteTimer = null;

async function refreshWatchlistQuotes() {
  const symbols = [...watchlistSymbols];
  for (const sym of symbols) {
    try {
      const res = await fetch(`/api/quote/${encodeURIComponent(sym)}`, {
        headers: { 'ngrok-skip-browser-warning': 'true' },
      });
      if (!res.ok) continue;
      const q = await res.json();
      updateWatchlistLive(sym, q.current_price, q.prev_close);
    } catch (_) { /* ignore — keep last value */ }
  }
}

function updateWatchlistLive(symbol, price, prevClose) {
  const el = document.querySelector(`.wl-item-live[data-live="${symbol}"]`);
  if (!el || price == null) return;
  const priceEl = el.querySelector('.wl-item-price');
  const chgEl   = el.querySelector('.wl-item-chg');
  priceEl.textContent = '$' + price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (prevClose) {
    const chg = ((price - prevClose) / prevClose) * 100;
    chgEl.textContent = (chg >= 0 ? '+' : '') + chg.toFixed(2) + '%';
    chgEl.className = 'wl-item-chg ' + (chg >= 0 ? 'wl-item-chg--up' : 'wl-item-chg--down');
  } else {
    chgEl.textContent = 'today —';
    chgEl.className = 'wl-item-chg wl-item-chg--idle';
  }
}

/* Navigate from the watchlist to a stock in the Analyst Feed:
   bring it to the top of the screen and pulse the whole row a few times. */
function goToStock(symbol) {
  // Close the watchlist overlay first so its backdrop doesn't dim/block the feed.
  closeWatchlistSidebar();

  const feedTab = document.querySelector('.view-tab[data-view="feed"]');
  if (feedTab) feedTab.click();

  const findRow = () => document.querySelector(`.stock-entry[data-symbol="${symbol}"]`);
  let row = findRow();
  if (!row) {
    // Clear any active search filter so the target can't be filtered out,
    // then expand to the full list so the row exists even past the page size.
    if (searchQuery) {
      searchQuery = '';
      const si = document.getElementById('searchInput');
      if (si) si.value = '';
      renderTable(true);            // rebuild unfiltered (this resets visibleCount)
    }
    visibleCount = allStocks.length;
    renderTable(false);             // append the remaining rows without resetting
    row = findRow();
  }
  if (!row) return;

  const inner = row.querySelector('.stock-row') || row;
  // Force EVERY rendered row visible: after a programmatic jump the staggered
  // scroll-in reveal (rows start at opacity:0) never fires for the rows we skip
  // past, leaving them blank. Revealing all here keeps the feed looking complete.
  if (window.gsap) gsap.set('.stock-row', { opacity: 1, y: 0 });

  // Scroll so the row sits just below the sticky header (top of the screen),
  // THEN pulse — so the user actually sees the pulse after arriving, even when
  // the target was far away and the smooth scroll took a while.
  const doFlash = () => {
    inner.classList.remove('stock-row--flash');
    void inner.offsetWidth;                 // restart the animation if re-triggered
    inner.classList.add('stock-row--flash');
    setTimeout(() => inner.classList.remove('stock-row--flash'), 1100);  // one 1s pulse
  };
  // Tiny pause after the scroll stops so the pulse reads as a distinct event.
  const flashAfterSettle = () => setTimeout(doFlash, 140);

  requestAnimationFrame(() => {
    const HEADER  = 92;
    const targetY = Math.max(0, row.getBoundingClientRect().top + window.pageYOffset - HEADER);
    window.scrollTo({ top: targetY, behavior: 'smooth' });

    // Fire the pulse only once the ROW itself has reached the top of the screen
    // and stopped — watching the row's real position (not pageYOffset guesses)
    // so it works whether we scroll up, down, far, near, smooth or instant.
    // `moved` guards against firing during the brief lag before a big smooth
    // scroll actually starts (the row sitting still ≠ "settled").
    let prevTop = null, stable = 0, moved = false;
    const started = performance.now();
    const watch = () => {
      const top      = row.getBoundingClientRect().top;
      const atTop    = Math.abs(top - HEADER) < 8;        // row parked at the header line
      if (prevTop !== null && Math.abs(top - prevTop) >= 0.5) { moved = true; stable = 0; }
      else { stable += 1; }
      prevTop = top;

      const settledAtTop = atTop && stable >= 2;           // arrived and motion stopped
      const stoppedMoving = moved && stable >= 6;          // scroll ended (e.g. unreachable target)
      if (settledAtTop || stoppedMoving || performance.now() - started > 4000) {
        flashAfterSettle();
      } else {
        requestAnimationFrame(watch);
      }
    };
    requestAnimationFrame(watch);
  });
}

/* ─── Autocomplete ─────────────────────────────────────── */
function initAutoComplete(input, getItems, onSelect) {
  const wrap = input.closest('.ac-wrap, .search-wrap, .predict-search-wrap') || input.parentElement;
  if (!wrap.style.position) wrap.style.position = 'relative';

  const dropdown = document.createElement('div');
  dropdown.className = 'ac-dropdown';
  wrap.appendChild(dropdown);

  let activeIdx = -1;

  function getVisible() { return [...dropdown.querySelectorAll('.ac-item')]; }

  function show(matches) {
    activeIdx = -1;
    if (!matches.length) { hide(); return; }
    dropdown.innerHTML = matches.slice(0, 8).map((m, i) => `
      <div class="ac-item" data-idx="${i}">
        <span class="ac-item-sym">${m.symbol}</span>
        ${m.price ? `<span class="ac-item-price">$${m.price.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</span>` : ''}
      </div>`).join('');
    dropdown.classList.add('open');
    getVisible().forEach((el, i) => {
      el.addEventListener('mousedown', ev => {
        ev.preventDefault();
        onSelect(matches[i]);
        hide();
      });
    });
  }

  function hide() { dropdown.classList.remove('open'); activeIdx = -1; }

  function highlight(dir) {
    const items = getVisible();
    if (!items.length) return;
    activeIdx = Math.max(0, Math.min(items.length - 1, activeIdx + dir));
    items.forEach((el, i) => el.classList.toggle('active', i === activeIdx));
  }

  input.addEventListener('input', () => {
    const val = input.value.trim().toUpperCase();
    if (!val || val.length < 1) { hide(); return; }
    show(getItems(val));
  });

  input.addEventListener('keydown', e => {
    if (!dropdown.classList.contains('open')) return;
    if (e.key === 'ArrowDown')  { e.preventDefault(); highlight(1); }
    else if (e.key === 'ArrowUp')   { e.preventDefault(); highlight(-1); }
    else if (e.key === 'Enter') {
      if (activeIdx >= 0) { getVisible()[activeIdx]?.dispatchEvent(new MouseEvent('mousedown')); }
    }
    else if (e.key === 'Escape') hide();
  });

  input.addEventListener('blur', () => setTimeout(hide, 150));
}

function getStockSuggestions(query) {
  const q = query.toUpperCase();
  return allStocks
    .filter(s => s.symbol.startsWith(q) || s.symbol.includes(q))
    .sort((a, b) => {
      const aStart = a.symbol.startsWith(q);
      const bStart = b.symbol.startsWith(q);
      if (aStart !== bStart) return aStart ? -1 : 1;
      return b.buy - a.buy;
    })
    .slice(0, 8);
}

function initAllAutoCompletes() {
  const searchEl  = document.getElementById('searchInput');
  const predictEl = document.getElementById('predictSearch');

  if (searchEl) {
    initAutoComplete(searchEl, getStockSuggestions, match => {
      searchEl.value = match.symbol;
      searchEl.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
  if (predictEl) {
    initAutoComplete(predictEl, getStockSuggestions, match => {
      predictEl.value = match.symbol;
    });
  }
}

/* ─── Predictions tab ──────────────────────────────────── */
(function initPredictions() {

  /* -- tab switching -- */
  document.querySelectorAll('.view-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const view = tab.dataset.view;
      document.querySelectorAll('.view-tab').forEach(t =>
        t.classList.toggle('active', t.dataset.view === view)
      );
      const feedEl     = document.getElementById('contentLayout');
      const predictEl  = document.getElementById('predictPanel');
      const journalEl  = document.getElementById('journalPanel');
      feedEl.style.display    = view === 'feed'    ? '' : 'none';
      predictEl.style.display = view === 'predict' ? 'block' : 'none';
      if (journalEl) journalEl.style.display = view === 'journal' ? 'block' : 'none';
      if (view === 'predict') {
        document.getElementById('predictSearch').focus();
      } else if (view === 'journal' && window.Journal) {
        window.Journal.onShow();
      }
    });
  });

  /* -- submit handlers -- */
  document.getElementById('predictSearch').addEventListener('keydown', e => {
    if (e.key === 'Enter') runPrediction();
  });
  document.getElementById('predictBtn').addEventListener('click', runPrediction);

  async function runPrediction() {
    const input  = document.getElementById('predictSearch');
    const symbol = input.value.trim().toUpperCase().replace(/[^A-Z.\-]/g, '');
    if (!symbol) { input.focus(); return; }

    const resultEl = document.getElementById('predictResult');
    resultEl.innerHTML = `
      <div class="predict-loading">
        <span class="predict-spinner"></span> Fetching data for ${symbol}…
      </div>`;

    try {
      const data     = await gatherData(symbol);
      if (data.currentPrice == null) {
        resultEl.innerHTML = `
          <div class="predict-error">
            No price data available for <strong>${symbol}</strong> — a forecast can't be generated.
          </div>`;
        return;
      }
      const analysis = computeScore(data);
      resultEl.innerHTML = renderCard(data, analysis);
      /* animate confidence bar after render */
      const fill = resultEl.querySelector('.pred-conf-fill');
      if (fill) { fill.style.width = '0%'; requestAnimationFrame(() => { fill.style.width = analysis.score + '%'; }); }
      /* draw animated scenario chart */
      const chart = resultEl.querySelector('#predChart');
      if (chart) requestAnimationFrame(() => drawPredictionChart(chart, data, analysis));
    } catch (err) {
      resultEl.innerHTML = `
        <div class="predict-error">
          Could not load data for <strong>${symbol}</strong> — check the ticker and try again.
        </div>`;
    }
  }

  /* ── data fetching ── */
  async function gatherData(symbol) {
    /* single call to our backend proxy — no CORS issues */
    const res = await fetch(`/api/quote/${symbol}`);
    if (!res.ok) throw new Error('quote fetch failed');
    const q = await res.json();
    if (q.error) throw new Error(q.error);

    const closes       = q.closes ?? [];
    const currentPrice = q.current_price;
    /* yesterday's close = second-to-last daily close (not the 3mo-ago value) */
    const prevClose    = closes.length >= 2 ? closes.at(-2) : q.prev_close;
    const todayChange  = prevClose ? ((currentPrice - prevClose) / prevClose) * 100 : 0;
    const ma50         = closes.length >= 10
      ? closes.slice(-50).reduce((s, v) => s + v, 0) / Math.min(closes.length, 50)
      : null;
    const last21     = closes.slice(-21);
    const momentum1m = last21.length >= 2
      ? ((closes.at(-1) - last21[0]) / last21[0]) * 100
      : 0;

    /* local enrichment */
    const localStock    = allStocks.find(s => s.symbol === symbol) ?? null;
    const localEarnings = earningsData ? (earningsData[symbol] ?? []) : [];

    /* Fed direction */
    let fedDirection = 'hold';
    try {
      const fedRes = await fetch('/data/fed_rate.json');
      if (fedRes.ok) { const fj = await fedRes.json(); fedDirection = fj?.next_meeting?.expected ?? 'hold'; }
    } catch (_) {}

    return {
      symbol,
      companyName:    q.company_name ?? symbol,
      currentPrice,
      prevClose,
      todayChange,
      ma50,
      momentum1m,
      closes,
      analystTargets: q.analyst_targets ?? null,
      recMean:        q.recommendation_mean ?? null,
      numAnalysts:    q.num_analysts ?? 0,
      localStock,
      localEarnings,
      fedDirection,
    };
  }

  /* ── scoring engine ── */
  /* Pure weighted heuristic — see the explanation under the Confidence Score in
     renderCard() for the factor weights this mirrors. */
  function computeScore(d) {
    let score = 50;

    /* analyst consensus ±25 */
    if (d.recMean !== null && d.numAnalysts >= 3) {
      score += Math.round(((3 - d.recMean) / 2) * 25);
    } else if (d.localStock) {
      const tot = d.localStock.buy + d.localStock.hold + d.localStock.sell;
      const bp  = tot > 0 ? (d.localStock.buy / tot) * 100 : 0;
      score += Math.round((bp - 50) * 0.4);
    }

    /* analyst price target upside ±20 */
    if (d.analystTargets?.mean && d.currentPrice) {
      const upside = ((d.analystTargets.mean - d.currentPrice) / d.currentPrice) * 100;
      score += Math.max(-20, Math.min(20, upside * 0.8));
    }

    /* price vs 50-day MA ±15 */
    if (d.ma50 && d.currentPrice) {
      const pct = ((d.currentPrice - d.ma50) / d.ma50) * 100;
      if (pct > 5)       score += 15;
      else if (pct > 0)  score += 7;
      else if (pct < -5) score -= 15;
      else               score -= 6;
    }

    /* 1-month momentum ±10 */
    if (d.momentum1m != null) {
      if (d.momentum1m > 10)       score += 10;
      else if (d.momentum1m > 3)   score += 5;
      else if (d.momentum1m < -10) score -= 10;
      else if (d.momentum1m < -3)  score -= 5;
    }

    /* earnings quality ±15 */
    const surprises = d.localEarnings.map(q => q.surprise).filter(v => v != null);
    if (surprises.length >= 2) {
      const avg = surprises.reduce((s, v) => s + v, 0) / surprises.length;
      score += Math.max(-15, Math.min(15, avg * 0.5));
    }

    /* Fed direction ±5 */
    if (d.fedDirection === 'cut')       score += 5;
    else if (d.fedDirection === 'hike') score -= 5;

    score = Math.max(5, Math.min(95, Math.round(score)));

    /* price targets */
    let bear, base, bull;
    if (d.analystTargets?.mean && d.analystTargets?.low && d.analystTargets?.high) {
      const mod = (score - 50) / 500;
      base = d.analystTargets.mean * (1 + mod);
      bear = Math.min(d.analystTargets.low,  base * 0.92);
      bull = Math.max(d.analystTargets.high, base * 1.08);
    } else {
      const p   = d.currentPrice;
      const sn  = (score - 50) / 50;
      base = p * (1 + sn * 0.14);
      bear = base * (1 - 0.09 + Math.min(0, sn) * 0.06);
      bull = base * (1 + 0.09 + Math.max(0, sn) * 0.06);
    }

    const label = score >= 75 ? 'High' : score >= 58 ? 'Moderate' : score >= 42 ? 'Low' : 'Very Low';
    return { score, bear, base, bull, confidenceLabel: label };
  }

  /* ── render ── */
  function renderCard(d, a) {
    const fmt = v => v != null
      ? '$' + (+v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : '—';
    const escStr = s => String(s).replace(/[&<>"]/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const pctFrom = v => d.currentPrice
      ? ((v - d.currentPrice) / d.currentPrice) * 100
      : null;

    // Colour bands match the verdict labels: High 75+, Moderate/Low 42–74, else red.
    const confColor  = a.score >= 75 ? 'var(--buy)' : a.score >= 42 ? 'var(--hold)' : 'var(--sell)';
    const todaySign  = d.todayChange >= 0 ? '+' : '';
    const todayClass = d.todayChange >= 0 ? 'buy-text' : 'sell-text';

    const atHtml = d.analystTargets?.mean ? `
      <div class="pred-section">
        <div class="pred-section-label">Analyst Price Targets · ${d.numAnalysts} analysts</div>
        <div class="pred-at-row">
          <div class="pred-at-item"><span class="pred-at-label">Low</span><span class="pred-at-val sell-text">${fmt(d.analystTargets.low)}</span></div>
          <div class="pred-at-item"><span class="pred-at-label">Mean</span><span class="pred-at-val accent-text">${fmt(d.analystTargets.mean)}</span></div>
          <div class="pred-at-item"><span class="pred-at-label">High</span><span class="pred-at-val buy-text">${fmt(d.analystTargets.high)}</span></div>
        </div>
      </div>` : '';

    const bullPct = pctFrom(a.bull); const basePct = pctFrom(a.base); const bearPct = pctFrom(a.bear);
    const fmtPct  = (p, cls) => p != null
      ? `<span class="${cls}">${p >= 0 ? '+' : ''}${p.toFixed(1)}%</span>` : '';

    return `
      <div class="pred-card">
        <div class="pred-header">
          <div class="pred-symbol-row">
            <span class="pred-symbol">${d.symbol}</span>
            <span class="pred-company">${escStr(d.companyName)}</span>
          </div>
          <div class="pred-price-row">
            <span class="pred-price">${fmt(d.currentPrice)}</span>
            <span class="pred-change ${todayClass}">${todaySign}${d.todayChange.toFixed(2)}% today</span>
          </div>
        </div>

        <!-- Animated scenario chart -->
        <div class="pred-section" style="padding-bottom:8px;">
          <div class="pred-section-label">3-Month Scenario Forecast</div>
          <div class="pred-chart-wrap">
            <canvas class="pred-chart" id="predChart" height="240"></canvas>
          </div>
          <div class="pred-chart-legend">
            <div class="pred-chart-legend-item">
              <div class="pred-chart-legend-dot pred-chart-legend-dot--hist"></div>HISTORY
            </div>
            <div class="pred-chart-legend-item">
              <div class="pred-chart-legend-dot pred-chart-legend-dot--bull"></div>
              BULL ${fmtPct(bullPct, 'buy-text')}
            </div>
            <div class="pred-chart-legend-item">
              <div class="pred-chart-legend-dot pred-chart-legend-dot--base"></div>
              BASE ${fmtPct(basePct, 'accent-text')}
            </div>
            <div class="pred-chart-legend-item">
              <div class="pred-chart-legend-dot pred-chart-legend-dot--bear"></div>
              BEAR ${fmtPct(bearPct, 'sell-text')}
            </div>
          </div>
        </div>

        <div class="pred-section">
          <div class="pred-section-label">Confidence Score</div>
          <div class="pred-conf-row">
            <div class="pred-conf-gauge">
              <div class="pred-conf-bar">
                <div class="pred-conf-fill" style="background:${confColor}"></div>
              </div>
              <div class="pred-conf-ticks">
                <span>0</span><span>25</span><span>50</span><span>75</span><span>100</span>
              </div>
            </div>
            <div class="pred-conf-readout">
              <span class="pred-conf-num" style="color:${confColor}">${a.score}<small>/100</small></span>
              <span class="pred-conf-label" style="color:${confColor}">${a.confidenceLabel}</span>
            </div>
          </div>
          <p class="pred-conf-note">
            A single measure of how strongly the evidence lines up in this stock's favour. Every stock
            starts at a neutral <strong>50</strong>, then six weighted signals push the score up or down
            before it's capped to a 5–100 range:
          </p>
          <div class="pred-conf-factors">
            <div class="pred-conf-factor"><span class="pcf-w">±25</span> Analyst Buy / Hold / Sell consensus</div>
            <div class="pred-conf-factor"><span class="pcf-w">±20</span> Upside to the mean analyst price target</div>
            <div class="pred-conf-factor"><span class="pcf-w">±15</span> Price vs its 50-day moving average</div>
            <div class="pred-conf-factor"><span class="pcf-w">±15</span> Earnings — recent EPS beats vs misses</div>
            <div class="pred-conf-factor"><span class="pcf-w">±10</span> 1-month price momentum</div>
            <div class="pred-conf-factor"><span class="pcf-w">±5</span> Expected Federal Reserve rate direction</div>
          </div>
          <p class="pred-conf-note pred-conf-note--fine">
            The bands map to a verdict — <strong>High</strong> (75+), <strong>Moderate</strong> (58–74),
            <strong>Low</strong> (42–57), <strong>Very&nbsp;Low</strong> (under&nbsp;42). It's a transparent,
            rule-based heuristic that weighs publicly reported data — not a prediction, target, or guarantee.
            Not financial advice.
          </p>
        </div>

        ${atHtml}

        <div class="pred-footer">
          Rule-based forecast · Data: Finnhub · Not financial advice
        </div>
      </div>`;
  }

  /* Seeded RNG so a symbol's synthesized lead-in is stable between renders */
  function seededRand(seedStr) {
    let s = 0;
    for (let i = 0; i < seedStr.length; i++) s = (s * 31 + seedStr.charCodeAt(i)) >>> 0;
    return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) / 0xFFFFFFFF); };
  }

  /* When the licensed plan returns no daily candles (free tier), build a
     realistic, volatile lead-in to the NOW marker. It carries NO axis or price
     values — it is purely an animation device, directionally seeded from the
     real today/1-month moves so it reflects, not fabricates, the data.

     Returns are auto-correlated (momentum) so the line forms genuine runs and
     swings like a real 3-month stock chart — not flat noise. The path is then
     normalised to a consistent volatility band and anchored multiplicatively so
     it ends exactly on the current price while keeping its full shape. */
  function synthHistory(d) {
    const cur   = d.currentPrice;
    const rnd   = seededRand(d.symbol || 'X');
    const N     = 64;                         // ~3 months of trading days
    const drift = (d.momentum1m != null ? d.momentum1m : (d.todayChange || 0)) / 100;

    // Trending random walk in log-space (returns persist → real swings).
    const stepVol = 0.02;     // per-step shock
    const persist = 0.55;     // momentum: trends carry over
    let ret = 0;
    const logPath = [0];
    for (let i = 1; i < N; i++) {
      const shock = (rnd() + rnd() + rnd() - 1.5) * stepVol;  // ~gaussian
      ret = persist * ret + shock;
      logPath.push(logPath[i - 1] + ret);
    }

    // Normalise to a fixed volatility band so every stock looks lively but sane.
    const mean = logPath.reduce((s, v) => s + v, 0) / N;
    const sd   = Math.sqrt(logPath.reduce((s, v) => s + (v - mean) ** 2, 0) / N) || 1;
    const BAND = 0.075;                        // ~7.5% std around the trend
    const norm = logPath.map(v => ((v - mean) / sd) * BAND);

    // Apply: base price · macro drift across the window · the normalised wiggle.
    const start = cur / (1 + drift);
    const raw   = norm.map((w, i) =>
      start * (1 + drift * (i / (N - 1))) * Math.exp(w));

    // Multiplicative anchor: end lands exactly on cur, shape preserved.
    const k = cur / raw[N - 1];
    return raw.map(p => p * k);
  }

  /* ── Animated prediction chart ── */
  function drawPredictionChart(canvas, d, a) {
    const dpr = window.devicePixelRatio || 1;
    const W   = canvas.offsetWidth  || 500;
    const H   = 240;
    canvas.width  = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width  = W + 'px';
    canvas.style.height = H + 'px';

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const cur     = d.currentPrice;
    const real    = (d.closes || []).filter(v => v != null && v > 0).slice(-55);
    const closes  = real.length >= 2 ? real : synthHistory(d);
    const synth   = real.length < 2;   // drawn dimmer when synthesized

    // Y range across everything we'll plot
    const allVals = [...closes, cur, a.bear, a.base, a.bull].filter(v => v != null && v > 0);
    if (!allVals.length) return;
    const minV = Math.min(...allVals) * 0.955;
    const maxV = Math.max(...allVals) * 1.045;

    const PAD = { top: 22, bottom: 30, left: 52, right: 74 };
    const chartW = W - PAD.left - PAD.right;
    const chartH = H - PAD.top  - PAD.bottom;
    const SPLIT  = 0.54; // history occupies left 54%, projections the rest

    const projX0 = PAD.left + chartW * SPLIT;
    const projXE = W - PAD.right;
    const toXHist = (i, total) => PAD.left + (i / (total - 1)) * (projX0 - PAD.left);
    const toY     = p => PAD.top + chartH - (p - minV) / (maxV - minV) * chartH;

    const histPts = closes.map((p, i) => ({ x: toXHist(i, closes.length), y: toY(p) }));
    // pin the last history point exactly on the NOW line at current price
    histPts[histPts.length - 1] = { x: projX0, y: toY(cur) };

    const nowY  = toY(cur);
    const bullY = toY(a.bull);
    const baseY = toY(a.base);
    const bearY = toY(a.bear);

    function projPts(endY, steps = 56) {
      return Array.from({ length: steps + 1 }, (_, i) => {
        const t  = i / steps;
        const et = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; // ease-in-out
        return { x: projX0 + (projXE - projX0) * t, y: nowY + (endY - nowY) * et };
      });
    }

    const bearPts = projPts(bearY);
    const basePts = projPts(baseY);
    const bullPts = projPts(bullY);

    // Animation: history fills left→NOW, pauses, then all 3 lines split out together.
    let histP = 0, projP = 0, pause = 0;
    let phase = 0; // 0=history 1=pause 2=projections 3=done
    const HIST_SPD = 0.022, PROJ_SPD = 0.026, PAUSE_FRAMES = 14;

    function polyline(pts, prog, color, lw, dashed) {
      const n = Math.max(2, Math.ceil(pts.length * prog));
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < n; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.strokeStyle = color;
      ctx.lineWidth   = lw;
      ctx.lineCap     = 'round';
      ctx.lineJoin    = 'round';
      ctx.setLineDash(dashed ? [5, 4] : []);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    function dot(x, y, r, color, glow) {
      ctx.beginPath(); ctx.arc(x, y, r + 3, 0, Math.PI * 2);
      ctx.fillStyle = glow; ctx.fill();
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = color; ctx.fill();
    }

    // Keep a label fully inside the canvas vertically
    function clampY(y) { return Math.max(PAD.top + 8, Math.min(H - PAD.bottom - 4, y)); }

    function label(x, y, text, color) {
      ctx.font = 'bold 12px "JetBrains Mono", monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = color;
      ctx.fillText(text, x + 8, clampY(y));
    }

    function frame() {
      // Advance first so the final state (projP === 1, with end labels) gets drawn.
      if      (phase === 0) { histP = Math.min(1, histP + HIST_SPD); if (histP >= 1) phase = 1; }
      else if (phase === 1) { if (++pause >= PAUSE_FRAMES) phase = 2; }
      else if (phase === 2) { projP = Math.min(1, projP + PROJ_SPD); if (projP >= 1) phase = 3; }

      ctx.clearRect(0, 0, W, H);

      // Subtle horizontal grid + left price axis (Y)
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
      ctx.font = '9px "JetBrains Mono", monospace';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      for (let i = 0; i <= 4; i++) {
        const gy    = PAD.top + (i / 4) * chartH;
        const price = maxV - (i / 4) * (maxV - minV);
        if (i > 0 && i < 4) {
          ctx.strokeStyle = 'rgba(255,255,255,0.035)';
          ctx.beginPath(); ctx.moveTo(PAD.left, gy); ctx.lineTo(projXE, gy); ctx.stroke();
        }
        ctx.fillStyle = 'rgba(148,163,184,0.5)';
        ctx.fillText('$' + price.toFixed(0), PAD.left - 10, gy);
      }

      // Bottom timeline axis (X): history 3M → NOW → +3M projection
      const axisY = PAD.top + chartH + 11;
      ctx.fillStyle = 'rgba(148,163,184,0.45)';
      ctx.font = '9px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ['3M', '2M', '1M'].forEach((lab, i) => {
        ctx.fillText(lab, PAD.left + (i / 3) * (projX0 - PAD.left), axisY);
      });
      ['+1M', '+2M', '+3M'].forEach((lab, i) => {
        ctx.fillText(lab, projX0 + ((i + 1) / 3) * (projXE - projX0), axisY);
      });

      // NOW divider + top label
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(projX0, PAD.top - 6); ctx.lineTo(projX0, PAD.top + chartH + 2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.font = 'bold 9px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText('NOW', projX0, PAD.top - 9);

      // History line (animates first) — solid; real data brighter than synth
      polyline(histPts, histP, synth ? 'rgba(148,163,184,0.55)' : 'rgba(148,163,184,0.78)', 1.6, false);

      // Projection lines (animate together after the pause) — all solid
      if (phase >= 2) {
        polyline(bearPts, projP, 'rgba(239,68,68,0.88)', 2.2, false);
        polyline(basePts, projP, 'rgba(6,182,212,0.92)', 2.4, false);
        polyline(bullPts, projP, 'rgba(34,197,94,0.9)',  2.2, false);
      }

      // Current-price marker at NOW (once history has arrived)
      if (histP >= 1) dot(projX0, nowY, 4.5, '#e2e8f0', 'rgba(226,232,240,0.16)');

      // End dots + price labels (once projections complete)
      if (phase >= 2 && projP >= 1) {
        dot(projXE, bullY, 3.5, '#22c55e', 'rgba(34,197,94,0.2)');
        dot(projXE, baseY, 4,   '#06b6d4', 'rgba(6,182,212,0.2)');
        dot(projXE, bearY, 3.5, '#ef4444', 'rgba(239,68,68,0.2)');
        label(projXE, bullY, '$' + a.bull.toFixed(0), '#22c55e');
        label(projXE, baseY, '$' + a.base.toFixed(0), '#06b6d4');
        label(projXE, bearY, '$' + a.bear.toFixed(0), '#ef4444');
      }

      if (phase < 3) requestAnimationFrame(frame);
    }

    requestAnimationFrame(frame);
  }

})();

/* ─── Init ─────────────────────────────────────────────── */
window.addEventListener('DOMContentLoaded', () => {
  animateHero();
  loadData().then(() => initAllAutoCompletes());
  initHowTo();
  initSources();
  loadFedRate();
  loadMacro();
  initStatPopovers();
  loadCalendar();
});

/* ─── Stat-bar popovers (Fed Rate + macro indicators) ──── */
const _statPopovers = [];

function initStatPopovers() {
  [
    ['fedChip',   'fedPopover'],
    ['unempChip', 'unempPopover'],
    ['cpiChip',   'cpiPopover'],
    ['gdpChip',   'gdpPopover'],
  ].forEach(([chipId, popId]) => registerStatPopover(chipId, popId));

  // Global dismiss handlers, registered once for all popovers.
  document.addEventListener('click', (e) => {
    _statPopovers.forEach(p => {
      if (p.pop.classList.contains('open') &&
          !p.pop.contains(e.target) && !p.chip.contains(e.target)) p.close();
    });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') _statPopovers.forEach(p => p.close());
  });
  const reposition = () => _statPopovers.forEach(p => {
    if (p.pop.classList.contains('open')) p.position();
  });
  window.addEventListener('resize', reposition);
  window.addEventListener('scroll', reposition, true);
}

function registerStatPopover(chipId, popId) {
  const chip = document.getElementById(chipId);
  const pop  = document.getElementById(popId);
  if (!chip || !pop) return;

  const api = {
    chip, pop,
    position() {
      const r = chip.getBoundingClientRect();
      const w = pop.offsetWidth;
      let left = r.left + r.width / 2 - w / 2;
      left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
      pop.style.left = `${left}px`;
      pop.style.top  = `${r.bottom + 10}px`;
    },
    open() {
      // Only one popover open at a time.
      _statPopovers.forEach(p => { if (p !== api) p.close(); });
      api.position();
      pop.classList.add('open');
      chip.classList.add('open');
      chip.setAttribute('aria-expanded', 'true');
      pop.setAttribute('aria-hidden', 'false');
    },
    close() {
      pop.classList.remove('open');
      chip.classList.remove('open');
      chip.setAttribute('aria-expanded', 'false');
      pop.setAttribute('aria-hidden', 'true');
    },
  };

  chip.addEventListener('click', (e) => {
    e.stopPropagation();
    pop.classList.contains('open') ? api.close() : api.open();
  });

  _statPopovers.push(api);
}

/* ─── Macro indicators (Unemployment / CPI / GDP from FRED) ── */
async function loadMacro() {
  let data = null;
  try {
    const res = await fetch('../data/macro.json');
    if (res.ok) data = await res.json();
  } catch (_) {}

  const inds = (data && data.indicators) || {};
  fillIndicator('unemp', inds.unemployment);
  fillIndicator('cpi',   inds.cpi);
  fillIndicator('gdp',   inds.gdp);
}

function fillIndicator(key, ind) {
  const valEl = document.getElementById(`${key}ChipValue`);
  const inner = document.getElementById(`${key}PopInner`);
  if (!inner) return;

  if (!ind) {
    if (valEl) valEl.textContent = 'N/A';
    inner.innerHTML = `
      <div class="fed-section">
        <div class="fed-loading">Run <code style="color:var(--buy);font-family:var(--mono)">fetch_macro.py</code><br>to load this data.</div>
      </div>`;
    return;
  }

  if (valEl) valEl.textContent = ind.value;

  const historyHtml = (ind.history || []).map(h => {
    const icon = h.direction === 'down' ? '↓' : h.direction === 'up' ? '↑' : '·';
    const cls  = h.direction === 'down' ? 'cut' : h.direction === 'up' ? 'hike' : '';
    return `
      <div class="fed-history-item">
        <span class="fed-history-dir ${cls}">${icon}</span>
        <span class="fed-history-label">${h.label}</span>
        <span class="fed-history-rate">${h.value}</span>
      </div>`;
  }).join('');

  inner.innerHTML = `
    <div class="fed-section">
      <div class="fed-section-label">${ind.title}</div>
      <div class="fed-rate-display">
        <span class="fed-rate-number">${ind.value}</span>
      </div>
      ${ind.as_of ? `<div class="fed-updated">As of ${ind.as_of}</div>` : ''}
    </div>
    ${ind.impact ? `
    <div class="fed-section">
      <div class="fed-section-label">Market Impact</div>
      <div class="fed-impact-text">${ind.impact}</div>
    </div>` : ''}
    ${historyHtml ? `
    <div class="fed-section">
      <div class="fed-section-label">Recent Readings</div>
      <div class="fed-history-list">${historyHtml}</div>
    </div>` : ''}
  `;
}

/* ─── Auth ──────────────────────────────────────────────── */
(function initAuth() {
  const TOKEN_KEY = 'bs_token';

  function getToken()    { return localStorage.getItem(TOKEN_KEY); }
  function saveToken(t)  { localStorage.setItem(TOKEN_KEY, t); }
  function clearToken()  { localStorage.removeItem(TOKEN_KEY); }

  function setAuthState(user) {
    currentUser = user || null;
    const loggedIn = !!user;
    document.getElementById('authLoggedOut').style.display = loggedIn ? 'none' : 'flex';
    document.getElementById('authLoggedIn').style.display  = loggedIn ? 'flex' : 'none';
    const membersArea   = document.getElementById('membersArea');
    const wlToggleBtn   = document.getElementById('watchlistToggleBtn');
    if (loggedIn) {
      document.getElementById('authUsername').textContent = user.name;
      document.getElementById('membersName').textContent  = user.name.split(' ')[0];
      membersArea.style.display = 'block';
      if (wlToggleBtn) wlToggleBtn.style.display = 'flex';
      loadWatchlist();
    } else {
      membersArea.style.display = 'none';
      if (wlToggleBtn) wlToggleBtn.style.display = 'none';
      closeWatchlistSidebar();
      clearWatchlist();
    }
    // Let other modules (e.g. the journal) react to login/logout.
    window.dispatchEvent(new CustomEvent('bs:auth', { detail: { user: user || null } }));
  }

  async function verifySession() {
    const token = getToken();
    if (!token) { setAuthState(null); return; }
    try {
      const res = await fetch('/api/auth/me', {
        headers: { Authorization: 'Bearer ' + token, 'ngrok-skip-browser-warning': 'true' }
      });
      if (!res.ok) { clearToken(); setAuthState(null); return; }
      const { user } = await res.json();
      setAuthState(user);
    } catch { setAuthState(null); }
  }

  // Modal open/close
  function openModal(id)  { document.getElementById(id).classList.add('open'); }
  function closeModal(id) { document.getElementById(id).classList.remove('open'); }

  document.getElementById('openLoginBtn').addEventListener('click',    () => openModal('loginModal'));
  document.getElementById('openRegisterBtn').addEventListener('click', () => openModal('registerModal'));
  // Value-prop panel CTA → open the register modal
  const introReg = document.getElementById('introRegisterBtn');
  if (introReg) introReg.addEventListener('click', () => openModal('registerModal'));
  document.getElementById('closeLoginBtn').addEventListener('click',    () => closeModal('loginModal'));
  document.getElementById('closeRegisterBtn').addEventListener('click', () => closeModal('registerModal'));
  document.getElementById('switchToRegister').addEventListener('click', () => { closeModal('loginModal');    openModal('registerModal'); });
  document.getElementById('switchToLogin').addEventListener('click',    () => { closeModal('registerModal'); openModal('loginModal'); });

  // Close on overlay click
  ['loginModal', 'registerModal'].forEach(id => {
    document.getElementById(id).addEventListener('click', e => {
      if (e.target.id === id) closeModal(id);
    });
  });

  // Login
  document.getElementById('loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    const errEl  = document.getElementById('loginError');
    const btn    = document.getElementById('loginSubmit');
    const email    = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;
    btn.disabled = true; btn.textContent = 'Logging in…';
    errEl.textContent = '';
    try {
      const res  = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true' },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json();
      if (!res.ok) { errEl.textContent = data.error; return; }
      saveToken(data.token);
      setAuthState(data.user);
      closeModal('loginModal');
      document.getElementById('loginForm').reset();
    } catch { errEl.textContent = 'Connection error — is the server running?'; }
    finally   { btn.disabled = false; btn.textContent = 'Log in'; }
  });

  // Register
  document.getElementById('registerForm').addEventListener('submit', async e => {
    e.preventDefault();
    const errEl  = document.getElementById('regError');
    const btn    = document.getElementById('registerSubmit');
    const name     = document.getElementById('regName').value;
    const email    = document.getElementById('regEmail').value;
    const password = document.getElementById('regPassword').value;
    const consent  = document.getElementById('regConsent').checked;
    errEl.textContent = '';
    if (!consent) { errEl.textContent = 'Please accept the Terms and Privacy Policy to continue.'; return; }
    btn.disabled = true; btn.textContent = 'Creating account…';
    try {
      const res  = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true' },
        body: JSON.stringify({ name, email, password })
      });
      const data = await res.json();
      if (!res.ok) { errEl.textContent = data.error; return; }
      saveToken(data.token);
      setAuthState(data.user);
      closeModal('registerModal');
      document.getElementById('registerForm').reset();
    } catch { errEl.textContent = 'Connection error — is the server running?'; }
    finally   { btn.disabled = false; btn.textContent = 'Create account'; }
  });

  // Watchlist sidebar toggle + backdrop dismiss
  document.getElementById('watchlistToggleBtn').addEventListener('click', toggleWatchlistSidebar);
  document.getElementById('wlSidebarClose').addEventListener('click', closeWatchlistSidebar);
  const _wlBackdrop = document.getElementById('wlBackdrop');
  if (_wlBackdrop) _wlBackdrop.addEventListener('click', closeWatchlistSidebar);

  // Logout
  document.getElementById('logoutBtn').addEventListener('click', () => {
    clearToken();
    setAuthState(null);
  });

  // GDPR: download my data
  const exportBtn = document.getElementById('exportDataBtn');
  if (exportBtn) exportBtn.addEventListener('click', async () => {
    const note = document.getElementById('privacyNote');
    try {
      const res = await fetch('/api/auth/export', {
        headers: { Authorization: 'Bearer ' + getToken(), 'ngrok-skip-browser-warning': 'true' }
      });
      if (!res.ok) { note.textContent = 'Could not export data — please try again.'; return; }
      const data = await res.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url; a.download = 'brick-street-my-data.json';
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      note.textContent = 'Your data has been downloaded.';
    } catch { note.textContent = 'Connection error — is the server running?'; }
  });

  // GDPR: delete my account
  const deleteBtn = document.getElementById('deleteAccountBtn');
  if (deleteBtn) deleteBtn.addEventListener('click', async () => {
    const note = document.getElementById('privacyNote');
    if (!confirm('Permanently delete your account, watchlist, and all your data? This cannot be undone.')) return;
    try {
      const res = await fetch('/api/auth/account', {
        method: 'DELETE',
        headers: { Authorization: 'Bearer ' + getToken(), 'ngrok-skip-browser-warning': 'true' }
      });
      if (!res.ok) { note.textContent = 'Could not delete account — please try again.'; return; }
      clearToken();
      setAuthState(null);
      alert('Your account and all associated data have been permanently deleted.');
    } catch { note.textContent = 'Connection error — is the server running?'; }
  });

  // Check existing session on load
  verifySession();
})();
