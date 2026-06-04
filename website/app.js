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

  const strongBuyCount = stocks.filter(x => {
    const t = x.buy + x.hold + x.sell;
    return t > 0 && (x.buy / t) >= 0.7;
  }).length;
  const strongBuyPct = Math.round((strongBuyCount / n) * 100);

  const topPick = stocks.reduce((best, x) => x.buy > best.buy ? x : best, stocks[0]);

  document.getElementById('stockCount').textContent = `${n} stocks`;

  countUp(document.getElementById('totalCount'),    n);
  countUp(document.getElementById('totalAnalysts'), totalAnalysts);
  countUp(document.getElementById('strongBuyPct'),  strongBuyPct, 1200, '%');

  const topPickEl = document.getElementById('topPick');
  if (topPickEl) {
    setTimeout(() => {
      topPickEl.textContent = topPick.symbol;
      gsap.from(topPickEl, { opacity: 0, y: 8, duration: 0.6, ease: 'power2.out' });
    }, 700);
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
  const flames   = stock.sell > 0 ? '🔥' : '·';
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
          <span class="sym-label">${stock.symbol}</span>
          ${priceStr ? `<span class="stock-price">${priceStr}</span>` : '<span class="stock-price">—</span>'}
          <button class="tv-btn" title="View ${stock.symbol} chart">
            <svg class="tv-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <polyline points="2,17 8,11 12,15 22,5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              <polyline points="16,5 22,5 22,11" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
          <button class="wl-btn${watchlistSymbols.has(stock.symbol) ? ' wl-btn--active' : ''}" data-symbol="${stock.symbol}" title="${watchlistSymbols.has(stock.symbol) ? 'Remove from watchlist' : 'Save to watchlist'}">
            <svg class="wl-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
        </div>
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
  `;

  const row          = entry.querySelector('.stock-row');
  const panel        = entry.querySelector('.chart-panel');
  const panelInner   = entry.querySelector('.chart-panel-inner');
  const frameWrap    = entry.querySelector('.chart-frame-wrap');
  const tvBtn        = entry.querySelector('.tv-btn');
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

  stocks.sort((a, b) => {
    if (sortKey === 'symbol') return sortDir * a.symbol.localeCompare(b.symbol);
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

/* ─── Sort buttons ─────────────────────────────────────── */
document.querySelectorAll('.sort-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const key = btn.dataset.sort;
    if (sortKey === key) {
      sortDir *= -1;
    } else {
      sortKey = key;
      sortDir = -1;
    }
    document.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    gsap.to('.stock-row', {
      opacity: 0, y: -10, duration: 0.2, stagger: 0.01,
      onComplete: () => {
        document.getElementById('tableBody').innerHTML = '';
        renderTable(true);
      }
    });
  });
});

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

/* ─── Earnings — pre-fetched from data/earnings.json ────── */
let earningsData = null;

async function loadEarningsFile() {
  try {
    const res = await fetch('../data/earnings.json');
    if (res.ok) earningsData = await res.json();
  } catch (_) {}
}

function earningsHtml(symbol) {
  if (!earningsData) return '<span class="earn-badge earn-badge--neutral">—</span>';
  const quarters = earningsData[symbol];
  if (!quarters || !quarters.length) {
    return '<span class="earn-badge earn-badge--neutral">N/A</span>';
  }
  return quarters.map(q => {
    const val = q.surprise;
    if (val === null || val === undefined) {
      return '<span class="earn-badge earn-badge--neutral">—</span>';
    }
    const isPos = val >= 0;
    const cls   = isPos ? 'earn-badge--pos' : 'earn-badge--neg';
    const sign  = isPos ? '+' : '';
    return `<span class="earn-badge ${cls}" title="${q.quarter || ''}">${sign}${val.toFixed(1)}%</span>`;
  }).join('');
}

/* ─── Fetch live prices ─────────────────────────────────── */
async function fetchPrice(symbol) {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1d`,
      { headers: { 'Accept': 'application/json' } }
    );
    if (!res.ok) return null;
    const json  = await res.json();
    const price = json?.chart?.result?.[0]?.meta?.regularMarketPrice;
    return price || null;
  } catch (_) { return null; }
}

async function enrichWithPrices(stocks) {
  const BATCH = 5;
  for (let i = 0; i < stocks.length; i += BATCH) {
    const batch = stocks.slice(i, i + BATCH);
    await Promise.all(batch.map(async stock => {
      if (stock.price) return;
      stock.price = await fetchPrice(stock.symbol);
    }));
    batch.forEach(stock => {
      if (!stock.price) return;
      const priceEl = document.querySelector(`.stock-entry[data-symbol="${stock.symbol}"] .stock-price`);
      if (priceEl) priceEl.textContent = formatPrice(stock.price);
    });
    await new Promise(r => setTimeout(r, 300));
  }
}

/* ─── Load data ─────────────────────────────────────────── */
async function loadData() {
  let data = null;

  try {
    const res = await fetch('../data/filtered_stocks.json');
    if (res.ok) {
      const json = await res.json();
      data = Object.entries(json).map(([symbol, vals]) => ({
        symbol,
        buy:   vals.buy   || 0,
        hold:  vals.hold  || 0,
        sell:  vals.sell  || 0,
        price: vals.price || null,
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
  renderTable();
  renderWatchlist();
  enrichWithPrices(allStocks);
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

  let data = null;
  try {
    const res = await fetch('../data/fed_rate.json');
    if (res.ok) data = await res.json();
  } catch (_) {}

  if (!data) {
    inner.innerHTML = `
      <div class="fed-section">
        <div class="fed-loading">Run <code style="color:var(--buy);font-family:var(--mono)">fetch_fed_rate.py</code><br>to load rate data.</div>
      </div>`;
    return;
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
    return `
      <div class="cal-event ${impactClass}" data-name="${e.name}">
        <div class="cal-event-top">${badgeHtml}${e.days_until != null ? daysLabel(e.days_until) : ''}</div>
        <div class="cal-event-name">${e.name}</div>
        <div class="cal-event-date">${e.label}${e.time ? ' · ' + e.time + ' ET' : ''}</div>
        ${valRow(e)}
        ${info ? '<div class="cal-expand-hint">click for details ▾</div>' : ''}
      </div>`;
  }

  const high   = events.filter(e => e.impact === 'high');
  const medium = events.filter(e => e.impact === 'medium');

  const listHtml = `
    ${high.length   ? `<div class="cal-section"><div class="cal-section-label">High Impact</div>${high.map(e => buildCard(e, 'high', '<span class="cal-event-badge high">⬤ HIGH</span>')).join('')}</div>` : ''}
    ${medium.length ? `<div class="cal-section"><div class="cal-section-label">Medium Impact</div>${medium.slice(0,10).map(e => buildCard(e, 'medium', '<span class="cal-event-badge medium">◆ MED</span>')).join('')}</div>` : ''}
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
          <div class="cal-detail-title">${e.name}</div>
          <div class="cal-detail-date-row">
            <span>${e.label}</span>
            ${e.time ? `<span>· ${e.time} ET</span>` : ''}
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
        const name = card.dataset.name;
        const ev   = events.find(e => e.name === name);
        if (ev) showDetail(ev);
      });
    });
  }

  attachCardClicks();
}

/* ─── Watchlist Sidebar ─────────────────────────────────── */
function openWatchlistSidebar() {
  const sidebar = document.getElementById('watchlistSidebar');
  const btn     = document.getElementById('watchlistToggleBtn');
  if (!sidebar) return;
  sidebar.classList.add('open');
  if (btn) btn.classList.add('active');
}

function closeWatchlistSidebar() {
  const sidebar = document.getElementById('watchlistSidebar');
  const btn     = document.getElementById('watchlistToggleBtn');
  if (!sidebar) return;
  sidebar.classList.remove('open');
  if (btn) btn.classList.remove('active');
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
    try {
      await fetch('/api/watchlist', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true' },
        body: JSON.stringify({ symbol })
      });
      watchlistSymbols.add(symbol);
    } catch (_) {}
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

function renderWatchlist() {
  const body    = document.getElementById('watchlistBody');
  const countEl = document.getElementById('watchlistCount');
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
    const stock = allStocks.find(s => s.symbol === symbol);
    if (!stock) {
      return `
        <div class="wl-item" data-symbol="${symbol}">
          <div class="wl-item-top">
            <div class="wl-item-id"><span class="wl-item-symbol">${symbol}</span></div>
            <button class="wl-item-remove" data-symbol="${symbol}" title="Remove">✕</button>
          </div>
        </div>`;
    }

    const total  = stock.buy + stock.hold + stock.sell;
    const buyPct = total > 0 ? Math.round((stock.buy / total) * 100) : 0;
    const price  = stock.price
      ? '$' + stock.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : '—';

    return `
      <div class="wl-item" data-symbol="${symbol}">
        <div class="wl-item-top">
          <div class="wl-item-id">
            <span class="wl-item-symbol">${symbol}</span>
            <span class="wl-item-price">${price}</span>
          </div>
          <button class="wl-item-remove" data-symbol="${symbol}" title="Remove from watchlist">✕</button>
        </div>
        <div class="wl-item-ratings">
          <span class="wl-buy">▲ ${stock.buy}</span>
          <span class="wl-hold">⏸ ${stock.hold}</span>
          <span class="wl-sell">${stock.sell > 0 ? '🔥' : '·'} ${stock.sell}</span>
        </div>
        <div class="wl-item-signal">
          <span class="wl-item-signal-pct">${buyPct}%</span>
          <div class="wl-signal-bar" style="flex:1"><div class="wl-signal-fill" style="width:${buyPct}%"></div></div>
        </div>
        <div class="wl-item-earnings">${earningsHtml(symbol)}</div>
      </div>`;
  }).join('');

  body.querySelectorAll('.wl-item-remove').forEach(btn => {
    btn.addEventListener('click', () => toggleWatchlist(btn.dataset.symbol));
  });
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
      if (view === 'predict') {
        feedEl.style.display    = 'none';
        predictEl.style.display = 'block';
        document.getElementById('predictSearch').focus();
      } else {
        feedEl.style.display    = '';
        predictEl.style.display = 'none';
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
      analystTargets: q.analyst_targets ?? null,
      recMean:        q.recommendation_mean ?? null,
      numAnalysts:    q.num_analysts ?? 0,
      localStock,
      localEarnings,
      fedDirection,
    };
  }

  /* ── scoring engine ── */
  function computeScore(d) {
    let score = 50;
    const signals = [], risks = [];

    /* analyst consensus ±25 */
    if (d.recMean !== null && d.numAnalysts >= 3) {
      score += Math.round(((3 - d.recMean) / 2) * 25);
      if (d.recMean <= 2.0)      signals.push(`Strong Buy consensus from ${d.numAnalysts} analysts`);
      else if (d.recMean <= 2.5) signals.push(`Buy consensus from ${d.numAnalysts} analysts`);
      else if (d.recMean >= 3.5) risks.push(`Weak analyst consensus (mean rating ${d.recMean.toFixed(1)}/5)`);
      else                       signals.push(`Neutral/Hold consensus from ${d.numAnalysts} analysts`);
    } else if (d.localStock) {
      const tot = d.localStock.buy + d.localStock.hold + d.localStock.sell;
      const bp  = tot > 0 ? (d.localStock.buy / tot) * 100 : 0;
      score += Math.round((bp - 50) * 0.4);
      if (bp >= 70)      signals.push(`${Math.round(bp)}% of ${tot} analysts rate Buy`);
      else if (bp >= 55) signals.push(`Buy-leaning consensus — ${Math.round(bp)}% Buy`);
      else               risks.push(`Mixed consensus — only ${Math.round(bp)}% Buy`);
    }

    /* analyst price target upside ±20 */
    if (d.analystTargets?.mean && d.currentPrice) {
      const upside = ((d.analystTargets.mean - d.currentPrice) / d.currentPrice) * 100;
      score += Math.max(-20, Math.min(20, upside * 0.8));
      if (upside >= 15)     signals.push(`Analysts see ${upside.toFixed(1)}% upside to mean target $${d.analystTargets.mean.toFixed(2)}`);
      else if (upside >= 5) signals.push(`${upside.toFixed(1)}% upside to analyst mean target $${d.analystTargets.mean.toFixed(2)}`);
      else if (upside < -2) risks.push(`Stock trades ${Math.abs(upside).toFixed(1)}% above analyst mean target — limited upside`);
    }

    /* price vs 50-day MA ±15 */
    if (d.ma50 && d.currentPrice) {
      const pct = ((d.currentPrice - d.ma50) / d.ma50) * 100;
      if (pct > 5)       { score += 15; signals.push(`Price ${pct.toFixed(1)}% above 50-day moving average — strong momentum`); }
      else if (pct > 0)  { score += 7;  signals.push(`Price ${pct.toFixed(1)}% above 50-day moving average`); }
      else if (pct < -5) { score -= 15; risks.push(`Price ${Math.abs(pct).toFixed(1)}% below 50-day moving average — weak trend`); }
      else               { score -= 6;  risks.push(`Price just below 50-day moving average`); }
    }

    /* 1-month momentum ±10 */
    if (d.momentum1m != null) {
      if (d.momentum1m > 10)      { score += 10; signals.push(`Strong 1-month momentum (+${d.momentum1m.toFixed(1)}%)`); }
      else if (d.momentum1m > 3)  { score += 5;  signals.push(`Positive 1-month trend (+${d.momentum1m.toFixed(1)}%)`); }
      else if (d.momentum1m < -10){ score -= 10; risks.push(`Weak 1-month performance (${d.momentum1m.toFixed(1)}%)`); }
      else if (d.momentum1m < -3) { score -= 5;  risks.push(`Negative 1-month trend (${d.momentum1m.toFixed(1)}%)`); }
    }

    /* earnings quality ±15 */
    const surprises = d.localEarnings.map(q => q.surprise).filter(v => v != null);
    if (surprises.length >= 2) {
      const avg   = surprises.reduce((s, v) => s + v, 0) / surprises.length;
      const beats = surprises.filter(v => v > 0).length;
      score += Math.max(-15, Math.min(15, avg * 0.5));
      if (beats >= 3 && avg > 5)  signals.push(`Beat earnings ${beats}/${surprises.length} quarters, avg surprise +${avg.toFixed(1)}%`);
      else if (beats >= 2)        signals.push(`Beat earnings estimates ${beats}/${surprises.length} recent quarters`);
      else                        risks.push(`Missed earnings ${surprises.length - beats}/${surprises.length} recent quarters`);
    }

    /* Fed direction ±5 */
    if (d.fedDirection === 'cut')  { score += 5; signals.push('Fed rate cut expected — positive tailwind for equities'); }
    else if (d.fedDirection === 'hike') { score -= 5; risks.push('Fed rate hike expected — headwind for valuations'); }
    else                           signals.push('Fed rate hold expected — neutral macro environment');

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
    return { score, signals, risks, bear, base, bull, confidenceLabel: label };
  }

  /* ── render ── */
  function renderCard(d, a) {
    const $ = v => v != null
      ? '$' + (+v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : '—';
    const esc = s => String(s).replace(/[&<>"]/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const pctFrom = v => d.currentPrice
      ? ((v - d.currentPrice) / d.currentPrice) * 100
      : null;

    function targetBox(cls, label, price, colorClass) {
      const p = pctFrom(price);
      const sign = p >= 0 ? '+' : '';
      return `
        <div class="pred-target pred-target--${cls}">
          <div class="pred-target-label">${label}</div>
          <div class="pred-target-price">${$(price)}</div>
          ${p != null ? `<div class="pred-target-pct ${colorClass}">${sign}${p.toFixed(1)}%</div>` : ''}
        </div>`;
    }

    const confColor = a.score >= 70 ? 'var(--buy)' : a.score >= 50 ? 'var(--hold)' : 'var(--sell)';
    const signalsHtml = a.signals.map(s =>
      `<div class="pred-signal pred-signal--pos"><span class="pred-signal-icon">▲</span><span>${s}</span></div>`
    ).join('');
    const risksHtml = a.risks.map(r =>
      `<div class="pred-signal pred-signal--neg"><span class="pred-signal-icon">▼</span><span>${r}</span></div>`
    ).join('');
    const atHtml = d.analystTargets?.mean ? `
      <div class="pred-section">
        <div class="pred-section-label">Analyst Price Targets · ${d.numAnalysts} analysts</div>
        <div class="pred-at-row">
          <div class="pred-at-item"><span class="pred-at-label">Low</span><span class="pred-at-val sell-text">${$(d.analystTargets.low)}</span></div>
          <div class="pred-at-item"><span class="pred-at-label">Mean</span><span class="pred-at-val accent-text">${$(d.analystTargets.mean)}</span></div>
          <div class="pred-at-item"><span class="pred-at-label">High</span><span class="pred-at-val buy-text">${$(d.analystTargets.high)}</span></div>
        </div>
      </div>` : '';
    const todaySign  = d.todayChange >= 0 ? '+' : '';
    const todayClass = d.todayChange >= 0 ? 'buy-text' : 'sell-text';

    return `
      <div class="pred-card">
        <div class="pred-header">
          <div class="pred-symbol-row">
            <span class="pred-symbol">${d.symbol}</span>
            <span class="pred-company">${esc(d.companyName)}</span>
          </div>
          <div class="pred-price-row">
            <span class="pred-price">${$(d.currentPrice)}</span>
            <span class="pred-change ${todayClass}">${todaySign}${d.todayChange.toFixed(2)}% today</span>
          </div>
        </div>

        <div class="pred-section">
          <div class="pred-section-label">3-Month Price Forecast</div>
          <div class="pred-targets">
            ${targetBox('bear', 'BEAR', a.bear, 'sell-text')}
            ${targetBox('base', 'BASE', a.base, 'accent-text')}
            ${targetBox('bull', 'BULL', a.bull, 'buy-text')}
          </div>
        </div>

        <div class="pred-section">
          <div class="pred-section-label">Confidence Score</div>
          <div class="pred-conf-row">
            <div class="pred-conf-bar">
              <div class="pred-conf-fill" style="width:0%;background:${confColor}"></div>
            </div>
            <span class="pred-conf-num" style="color:${confColor}">${a.score}/100</span>
            <span class="pred-conf-label">${a.confidenceLabel}</span>
          </div>
        </div>

        ${signalsHtml || risksHtml ? `
        <div class="pred-section">
          <div class="pred-section-label">Key Signals</div>
          <div class="pred-signals">${signalsHtml}${risksHtml}</div>
        </div>` : ''}

        ${atHtml}

        <div class="pred-footer">
          Rule-based forecast · Data: Yahoo Finance · Not financial advice
        </div>
      </div>`;
  }

})();

/* ─── Init ─────────────────────────────────────────────── */
window.addEventListener('DOMContentLoaded', () => {
  animateHero();
  loadData();
  initHowTo();
  initSources();
  loadFedRate();
  loadCalendar();
});

/* ─── Auth ──────────────────────────────────────────────── */
(function initAuth() {
  const TOKEN_KEY = 'bs_token';

  function getToken()    { return localStorage.getItem(TOKEN_KEY); }
  function saveToken(t)  { localStorage.setItem(TOKEN_KEY, t); }
  function clearToken()  { localStorage.removeItem(TOKEN_KEY); }

  function setAuthState(user) {
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
    btn.disabled = true; btn.textContent = 'Creating account…';
    errEl.textContent = '';
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

  // Watchlist sidebar toggle
  document.getElementById('watchlistToggleBtn').addEventListener('click', toggleWatchlistSidebar);
  document.getElementById('wlSidebarClose').addEventListener('click', closeWatchlistSidebar);

  // Logout
  document.getElementById('logoutBtn').addEventListener('click', () => {
    clearToken();
    setAuthState(null);
  });

  // Check existing session on load
  verifySession();
})();
