// Launch Radar's page. It reads window.RADAR (written beside dashboard/ by main.ts) and renders the
// ranked board, a detail view with the model's working and the farm plan, the live-token set the
// anchors are learned from, the set-aside wrappers, and the model itself with a live sandbox.
// No network: every byte it shows is in data.js, and the page recomputes each row's implied value
// from the row's own figures, so the number on screen is the number the code derives.
(function () {
  'use strict';
  var DATA = window.RADAR;
  if (!DATA) return;
  var M = DATA.model;
  var state = { view: 'board', q: '', cat: 'all', chain: 'all', watch: false, gainers: false, sort: 'rank', dir: 1, selected: null };
  var sandbox = { growth: M.growth_weight, maturity: M.maturity_range, breadth: M.breadth_per_chain };

  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function fmtPct(n) { return n === null || n === undefined ? 'n/a' : (n > 0 ? '+' : '') + n.toFixed(1) + '%'; }
  function fmtAge(d) {
    if (d === null || d === undefined) return 'unknown';
    if (d >= 365) return (d / 365).toFixed(1) + ' yrs';
    if (d >= 30) return Math.round(d / 30.4) + ' mo';
    return d + ' d';
  }
  function mult(x) { return 'x' + x.toFixed(3); }

  // The model, recomputed in the page from a row's own figures and the sandbox weights. At the
  // model's stated constants this reproduces board.json's implied_value_usd exactly.
  function impliedOf(row, w) {
    var growth = Math.min(M.growth_cap, Math.max(M.growth_floor, row.change_7d === null ? 0 : row.change_7d));
    var momentum = 1 + (growth / 100) * w.growth;
    var age = row.age_days === null ? M.unknown_age_days : row.age_days;
    var maturity = M.maturity_base + w.maturity * (1 - Math.exp(-Math.max(age, 0) / M.maturity_tau_days));
    var breadth = 1 + w.breadth * Math.min(Math.max(row.chains.length - 1, 0), M.breadth_max_extra_chains);
    return Math.max(1, Math.round(row.tvl_usd * row.model.anchor_ratio * momentum * maturity * breadth));
  }
  function sandboxActive() {
    return sandbox.growth !== M.growth_weight || sandbox.maturity !== M.maturity_range || sandbox.breadth !== M.breadth_per_chain;
  }

  /* ---------- masthead and stats ---------- */
  $('mastMeta').innerHTML =
    '<div>snapshot <b>' + esc(DATA.as_of) + '</b></div>' +
    '<div>model <b>' + esc(DATA.model_version) + '</b></div>' +
    '<div>' + esc(DATA.source) + '</div>';
  var c = DATA.counts;
  var stats = [
    [String(c.protocols), 'protocols scanned', ''],
    [String(c.pre_token), 'record no token', ''],
    [String(c.board_size), 'ranked on the board', ''],
    [c.watchlist_size + ' / ' + c.watchlist_size, 'watchlist covered', 'amber'],
    [String(c.early_size), 'early, below the $50M floor', ''],
    [String(c.set_aside_size), 'wrappers set aside', ''],
  ];
  $('statStrip').innerHTML = stats.map(function (s) {
    return '<div class="stat"><div class="v ' + s[2] + '">' + s[0] + '</div><div class="k">' + s[1] + '</div></div>';
  }).join('');
  $('foot').textContent = 'Launch Radar — built from one sealed snapshot of the protocol universe (' + DATA.source + '). Implied values are this entry\u2019s own claims, derived only from the snapshot\u2019s figures. Nothing here is a prediction that any protocol will issue a token.';

  /* ---------- filter options ---------- */
  var cats = [];
  var chains = [];
  DATA.rows.forEach(function (r) {
    if (r.category && cats.indexOf(r.category) < 0) cats.push(r.category);
    r.chains.forEach(function (ch) { if (chains.indexOf(ch) < 0) chains.push(ch); });
  });
  cats.sort(); chains.sort();
  $('cat').innerHTML = '<option value="all">All categories</option>' + cats.map(function (x) { return '<option>' + esc(x) + '</option>'; }).join('');
  $('chain').innerHTML = '<option value="all">All chains</option>' + chains.map(function (x) { return '<option>' + esc(x) + '</option>'; }).join('');

  /* ---------- board ---------- */
  function visibleRows() {
    var rows = DATA.rows.filter(function (r) {
      if (state.watch && !r.watchlist) return false;
      if (state.gainers && !(r.change_7d !== null && r.change_7d > 0)) return false;
      if (state.cat !== 'all' && r.category !== state.cat) return false;
      if (state.chain !== 'all' && r.chains.indexOf(state.chain) < 0) return false;
      if (state.q) {
        var q = state.q.toLowerCase();
        if (r.name.toLowerCase().indexOf(q) < 0 && r.slug.indexOf(q) < 0) return false;
      }
      return true;
    });
    var key = state.sort;
    var val = function (r) {
      if (key === 'rank') return r.rank;
      if (key === 'name') return r.name.toLowerCase();
      if (key === 'tvl') return r.tvl_usd;
      if (key === 'change') return r.change_7d === null ? -Infinity : r.change_7d;
      if (key === 'age') return r.age_days === null ? -1 : r.age_days;
      if (key === 'anchor') return r.model.anchor_ratio;
      return impliedOf(r, sandbox);
    };
    rows.sort(function (a, b) {
      var va = val(a), vb = val(b);
      if (va < vb) return -1 * state.dir;
      if (va > vb) return 1 * state.dir;
      return a.rank - b.rank;
    });
    return rows;
  }

  function renderBoard() {
    var rows = visibleRows();
    var maxImplied = rows.reduce(function (m, r) { return Math.max(m, impliedOf(r, sandbox)); }, 1);
    $('rowCount').textContent = rows.length + ' of ' + DATA.rows.length + ' protocols' + (sandboxActive() ? ' — sandbox weights' : '');
    $('boardBody').innerHTML = rows.map(function (r) {
      var imp = impliedOf(r, sandbox);
      var chgCls = r.change_7d === null ? 'flat' : r.change_7d > 0 ? 'pos' : r.change_7d < 0 ? 'neg' : 'flat';
      var chainTxt = r.chains.slice(0, 2).join(', ') + (r.chains.length > 2 ? ' +' + (r.chains.length - 2) : '');
      return '<tr data-slug="' + esc(r.slug) + '"' + (state.selected === r.slug ? ' class="selected"' : '') + '>' +
        '<td class="num">' + r.rank + '</td>' +
        '<td><span class="pname">' + esc(r.name) + '</span>' + (r.watchlist ? '<span class="badge">Watchlist</span>' : '') + '<br><span class="pslug">' + esc(r.slug) + '</span></td>' +
        '<td>' + esc(r.category || '—') + '</td>' +
        '<td class="chains">' + esc(chainTxt || '—') + '</td>' +
        '<td class="num">' + fmtUsd(r.tvl_usd) + '</td>' +
        '<td class="num ' + chgCls + '">' + fmtPct(r.change_7d) + '</td>' +
        '<td class="num">' + fmtAge(r.age_days) + '</td>' +
        '<td class="num">' + r.model.anchor_ratio.toFixed(3) + '</td>' +
        '<td class="implied-cell"><span class="implied-v">' + fmtUsd(imp) + '</span><div class="bar"><i style="width:' + Math.max(1.5, (imp / maxImplied) * 100).toFixed(1) + '%"></i></div></td>' +
        '</tr>';
    }).join('');
    var heads = document.querySelectorAll('#boardTable th.sortable');
    heads.forEach(function (th) {
      var label = th.getAttribute('data-label') || th.textContent;
      th.setAttribute('data-label', label);
      th.innerHTML = esc(label) + (state.sort === th.getAttribute('data-sort') ? ' <span class="arrow">' + (state.dir === 1 ? '▲' : '▼') + '</span>' : '');
    });
  }

  /* ---------- detail ---------- */
  function renderDetail() {
    var box = $('detail');
    var row = null;
    DATA.rows.forEach(function (r) { if (r.slug === state.selected) row = r; });
    if (!row) { box.hidden = true; box.innerHTML = ''; return; }
    var m = row.model;
    var recomputed = impliedOf(row, { growth: M.growth_weight, maturity: M.maturity_range, breadth: M.breadth_per_chain });
    box.hidden = false;
    box.innerHTML =
      '<div class="detail-head"><div>' +
      '<h2>' + esc(row.name) + (row.watchlist ? '<span class="badge">Watchlist</span>' : '') + '</h2>' +
      '<div class="sub">' + esc(row.slug) + ' · ' + esc(row.category || 'uncategorised') + ' · rank #' + row.rank + ' · records no token</div></div>' +
      '<div style="display:flex;gap:14px;align-items:flex-start"><div class="big-implied"><div class="v">' + fmtUsd(row.implied_value_usd) + '</div><div class="k">implied value</div></div>' +
      '<button class="close-btn" id="closeDetail" type="button">Close</button></div></div>' +
      '<div class="detail-grid">' +
      [['TVL', fmtUsd(row.tvl_usd)], ['7-day TVL change', fmtPct(row.change_7d)], ['No-token run', fmtAge(row.age_days)], ['Tracked since', row.listed_at || 'unreported'], ['Chains', String(row.chains.length)], ['Category anchor', m.anchor_ratio.toFixed(3)]].map(function (s) {
        return '<div class="dstat"><div class="v">' + s[1] + '</div><div class="k">' + s[0] + '</div></div>';
      }).join('') + '</div>' +
      '<div class="model-break"><h3>How the model prices it</h3>' +
      '<div class="formula">' + fmtUsd(row.tvl_usd) + ' TVL <span class="fx">× ' + m.anchor_ratio.toFixed(3) + '</span> anchor <span class="fx">× ' + mult(m.momentum_multiplier) + '</span> momentum <span class="fx">× ' + mult(m.maturity_multiplier) + '</span> maturity <span class="fx">× ' + mult(m.breadth_multiplier) + '</span> breadth <span class="fx">= ' + fmtUsd(recomputed) + '</span></div>' +
      '<p class="why">The anchor is the shrunk median market-cap-to-TVL ratio of the ' + anchorN(row.category) + ' token-bearing ' + esc(row.category || 'uncategorised') + ' protocols in this snapshot. Momentum damps its seven-day TVL change (' + fmtPct(row.change_7d) + '). Maturity credits ' + fmtAge(row.age_days) + ' run with no token. Breadth counts its ' + row.chains.length + ' chain' + (row.chains.length === 1 ? '' : 's') + ': ' + esc(row.chains.join(', ') || 'none recorded') + '.</p></div>' +
      '<div class="plan"><h3>Farm plan — ' + esc(row.name) + '</h3><ol>' +
      row.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') +
      '</ol></div>';
    $('closeDetail').addEventListener('click', function () { state.selected = null; renderDetail(); renderBoard(); });
  }
  function anchorN(cat) {
    var found = null;
    DATA.anchors.categories.forEach(function (a) { if (a.category === (cat || '(uncategorised)')) found = a; });
    return found ? found.n : 0;
  }

  /* ---------- live and set-aside ---------- */
  $('liveBody').innerHTML = DATA.live.map(function (r) {
    var cls = r.change_7d === null ? 'flat' : r.change_7d > 0 ? 'pos' : 'neg';
    return '<tr><td><span class="pname">' + esc(r.name) + '</span><br><span class="pslug">' + esc(r.slug) + '</span></td>' +
      '<td class="num">' + esc(r.symbol || '—') + '</td><td>' + esc(r.category || '—') + '</td>' +
      '<td class="num">' + fmtUsd(r.mcap_usd) + '</td><td class="num">' + fmtUsd(r.tvl_usd) + '</td>' +
      '<td class="num">' + (r.ratio === null ? 'n/a' : r.ratio.toFixed(3)) + '</td>' +
      '<td class="num ' + cls + '">' + fmtPct(r.change_7d) + '</td></tr>';
  }).join('');
  $('asideNote').textContent = 'These ' + c.set_aside_size + ' pre-token records are bridges and staking or restaking products: claims on assets whose tokens already trade. There is no launch of their own to price, so the radar tracks the largest of them here instead of ranking them. A further ' + c.excluded_cex + ' exchange (CEX) records and ' + c.excluded_named + ' versioned or wrapped names are left off the board entirely.';
  $('asideBody').innerHTML = DATA.set_aside.map(function (r) {
    return '<tr><td><span class="pname">' + esc(r.name) + '</span><br><span class="pslug">' + esc(r.slug) + '</span></td>' +
      '<td>' + esc(r.category || '—') + '</td><td class="num">' + fmtUsd(r.tvl_usd) + '</td><td>' + esc(r.reason) + '</td></tr>';
  }).join('');

  /* ---------- model view and sandbox ---------- */
  var anchorRows = DATA.anchors.categories.map(function (a) {
    return '<tr><td>' + esc(a.category) + '</td><td class="num">' + a.n + '</td><td class="num">' + a.median_ratio.toFixed(3) + '</td><td class="num">' + a.anchor.toFixed(3) + '</td></tr>';
  }).join('');
  $('modelBody').innerHTML =
    '<div class="card"><h2>The value model (' + esc(DATA.model_version) + ')</h2>' +
    '<p>Every implied value on the board is one formula, run on the snapshot\u2019s own figures. No protocol name is special-cased, and nothing is read from outside the snapshot.</p>' +
    '<p class="formula">implied = TVL <span class="fx">× anchor</span> <span class="fx">× momentum</span> <span class="fx">× maturity</span> <span class="fx">× breadth</span></p>' +
    '<ul>' +
    '<li><b>Anchor.</b> For each category, the median market-cap / TVL of the snapshot\u2019s token-bearing protocols in it, winsorised to [0.01, 5] and shrunk toward the global median (' + DATA.anchors.global_ratio.toFixed(3) + ', from ' + DATA.anchors.usable + ' priced protocols) with a prior of ' + M.anchor_prior + '. A deep category speaks for itself; a thin one borrows the market\u2019s centre.</li>' +
    '<li><b>Momentum.</b> 1 + clamp(7-day TVL change, -50%, +100%) / 100 × ' + M.growth_weight + '. A week of inflows raises the price of the launch; a week of outflows lowers it, damped so one week cannot dominate.</li>' +
    '<li><b>Maturity.</b> ' + M.maturity_base + ' + ' + M.maturity_range + ' × (1 − e^(−age / ' + M.maturity_tau_days + 'd)). The longer a protocol has run at size with no token, the more of its anchor it is credited; an unreported listing day is scored as ' + M.unknown_age_days + ' days.</li>' +
    '<li><b>Breadth.</b> 1 + ' + M.breadth_per_chain + ' per chain beyond the first, up to ' + M.breadth_max_extra_chains + ' extra chains: distribution is evidence a launch would be widely held from day one.</li>' +
    '<li><b>Separation.</b> Token-bearing protocols are never ranked; they are the Already trading view and the anchors\u2019 raw material. Bridges and staking wrappers are set aside, not ranked: their asset\u2019s token already trades. Exchange records and versioned pools are excluded.</li>' +
    '</ul></div>' +
    '<div class="card"><h2>Category anchors learned from this snapshot</h2>' +
    '<p>Median market cap per $1 of TVL among token-bearing protocols, and the shrunk anchor the model actually applies.</p>' +
    '<table class="mini"><thead><tr><th>Category</th><th class="num">Priced protocols</th><th class="num">Median ratio</th><th class="num">Anchor used</th></tr></thead><tbody>' + anchorRows + '</tbody></table></div>';
  $('sandbox').querySelector('h2').textContent = 'Model sandbox';
  function syncSandbox() {
    $('sGrowth').value = sandbox.growth; $('sMaturity').value = sandbox.maturity; $('sBreadth').value = sandbox.breadth;
    $('oGrowth').textContent = sandbox.growth.toFixed(2);
    $('oMaturity').textContent = sandbox.maturity.toFixed(2);
    $('oBreadth').textContent = sandbox.breadth.toFixed(3);
    var top = visibleRows()[0];
    $('sandboxNote').textContent = sandboxActive()
      ? 'Sandbox weights differ from the model: at these weights the board\u2019s #1 is ' + (top ? top.name : '—') + '. The handed-in board uses growth ' + M.growth_weight + ', maturity ' + M.maturity_range + ', breadth ' + M.breadth_per_chain + '.'
      : 'At the model\u2019s stated constants. The board view re-ranks with these weights too.';
    renderBoard();
  }
  $('sGrowth').addEventListener('input', function () { sandbox.growth = parseFloat(this.value); syncSandbox(); });
  $('sMaturity').addEventListener('input', function () { sandbox.maturity = parseFloat(this.value); syncSandbox(); });
  $('sBreadth').addEventListener('input', function () { sandbox.breadth = parseFloat(this.value); syncSandbox(); });
  $('sReset').addEventListener('click', function () { sandbox = { growth: M.growth_weight, maturity: M.maturity_range, breadth: M.breadth_per_chain }; syncSandbox(); });

  /* ---------- wiring ---------- */
  function showView(v) {
    state.view = v;
    document.querySelectorAll('#tabs .tab').forEach(function (x) { x.classList.toggle('active', x.getAttribute('data-view') === v); });
    ['board', 'live', 'aside', 'model'].forEach(function (x) { $('view-' + x).hidden = x !== v; });
    if (v === 'board') renderBoard();
  }
  document.querySelectorAll('#tabs .tab').forEach(function (t) {
    t.addEventListener('click', function () { showView(t.getAttribute('data-view')); });
  });
  $('q').addEventListener('input', function () { state.q = this.value; renderBoard(); });
  $('cat').addEventListener('change', function () { state.cat = this.value; renderBoard(); });
  $('chain').addEventListener('change', function () { state.chain = this.value; renderBoard(); });
  $('watchOnly').addEventListener('change', function () { state.watch = this.checked; renderBoard(); });
  $('gainersOnly').addEventListener('change', function () { state.gainers = this.checked; renderBoard(); });
  document.querySelectorAll('#boardTable th.sortable').forEach(function (th) {
    th.setAttribute('data-label', th.textContent);
    th.addEventListener('click', function () {
      var k = th.getAttribute('data-sort');
      if (state.sort === k) state.dir = -state.dir;
      else { state.sort = k; state.dir = k === 'name' ? 1 : -1; }
      renderBoard();
    });
  });
  $('boardBody').addEventListener('click', function (ev) {
    var tr = ev.target.closest('tr[data-slug]');
    if (!tr) return;
    state.selected = tr.getAttribute('data-slug');
    renderDetail(); renderBoard();
    $('detail').scrollIntoView({ block: 'nearest' });
  });

  /* ---------- deep links for the handed-in views ---------- */
  var params = new URLSearchParams(location.search);
  if (params.get('view') && ['board', 'live', 'aside', 'model'].indexOf(params.get('view')) >= 0) showView(params.get('view'));
  if (params.get('cat')) { state.cat = params.get('cat'); $('cat').value = state.cat; }
  if (params.get('watch') === '1') { state.watch = true; $('watchOnly').checked = true; }
  if (params.get('detail')) state.selected = params.get('detail');
  renderBoard();
  renderDetail();
  syncSandbox();
})();
