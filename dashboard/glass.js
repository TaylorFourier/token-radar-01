(function () {
  'use strict';

  var data = window.FIELD_GLASS;
  var board = document.getElementById('rows');
  var detail = document.getElementById('detail');
  var count = document.getElementById('count');
  var leaders = document.getElementById('leaders');
  var state = {
    q: '',
    lane: 'unlaunched',
    category: '',
    chain: '',
    rising: false,
    sort: 'rank',
    dir: 1,
    selected: null
  };

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        var value = attrs[key];
        if (key === 'class') node.className = value;
        else if (key === 'text') node.textContent = value;
        else if (value === false || value == null) return;
        else node.setAttribute(key, value === true ? '' : String(value));
      });
    }
    for (var i = 2; i < arguments.length; i++) append(node, arguments[i]);
    return node;
  }

  function append(node, child) {
    if (child == null || child === false) return;
    if (Array.isArray(child)) child.forEach(function (c) { append(node, c); });
    else if (typeof child === 'string' || typeof child === 'number') node.appendChild(document.createTextNode(String(child)));
    else node.appendChild(child);
  }

  function money(n) {
    if (n == null || !isFinite(n)) return 'n/a';
    var abs = Math.abs(n);
    var sign = n < 0 ? '-' : '';
    if (abs >= 1e9) return sign + '$' + (abs / 1e9).toFixed(2) + 'B';
    if (abs >= 1e6) return sign + '$' + (abs / 1e6).toFixed(2) + 'M';
    if (abs >= 1e3) return sign + '$' + (abs / 1e3).toFixed(1) + 'K';
    return sign + '$' + Math.round(abs).toLocaleString('en-US');
  }

  function fullMoney(n) {
    if (n == null || !isFinite(n)) return 'n/a';
    return (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-US');
  }

  function pct(n) {
    if (n == null || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }

  function ageText(days) {
    if (days == null) return 'unreported';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return days + 'd';
  }

  function missing() {
    detail.hidden = false;
    detail.appendChild(el('h2', { text: 'No book loaded' }));
    detail.appendChild(el('p', { class: 'quiet', text: 'Run main.ts so data.js is written beside this dashboard folder, then open index.html from that output folder.' }));
  }

  if (!data || !Array.isArray(data.rows)) {
    missing();
    return;
  }

  var categories = [];
  var chains = [];
  var catSeen = Object.create(null);
  var chainSeen = Object.create(null);
  data.rows.forEach(function (row) {
    var cat = row.category || 'Uncategorised';
    if (!catSeen[cat]) { catSeen[cat] = true; categories.push(cat); }
    (row.chains || []).forEach(function (chain) {
      if (!chainSeen[chain]) { chainSeen[chain] = true; chains.push(chain); }
    });
  });
  categories.sort();
  chains.sort();

  function fillSelect(id, values) {
    var select = document.getElementById(id);
    values.forEach(function (value) {
      select.appendChild(el('option', { value: value, text: value }));
    });
  }
  fillSelect('category', categories);
  fillSelect('chain', chains);

  var stats = document.getElementById('mast-stats');
  [
    ['As of', data.as_of],
    ['Protocols', String(data.counts.protocols)],
    ['Unlaunched', String(data.counts.unlaunched)],
    ['Floor', String(data.counts.watchlist)],
    ['Recorded', String(data.counts.recorded)]
  ].forEach(function (pair) {
    stats.appendChild(el('div', null, el('dt', { text: pair[0] }), el('dd', { text: pair[1] })));
  });

  function matches(row) {
    if (state.lane === 'unlaunched' && row.lane !== 'unlaunched') return false;
    if (state.lane === 'recorded' && row.lane !== 'recorded') return false;
    if (state.lane === 'watchlist' && !row.on_watchlist) return false;
    if (state.category && (row.category || 'Uncategorised') !== state.category) return false;
    if (state.chain && (row.chains || []).indexOf(state.chain) < 0) return false;
    if (state.rising && !(typeof row.change_7d === 'number' && row.change_7d > 0)) return false;
    if (state.q) {
      var hay = (row.name + ' ' + row.slug + ' ' + (row.category || '') + ' ' + (row.chains || []).join(' ')).toLowerCase();
      if (hay.indexOf(state.q) < 0) return false;
    }
    return true;
  }

  function valueOf(row, key) {
    if (key === 'rank') return row.rank;
    if (key === 'name') return row.name.toLowerCase();
    if (key === 'lane') return row.lane;
    if (key === 'category') return (row.category || '').toLowerCase();
    if (key === 'tvl') return row.tvl_usd;
    if (key === 'change') return row.change_7d == null ? -1e18 : row.change_7d;
    if (key === 'age') return row.age_days == null ? -1 : row.age_days;
    return row.implied_value_usd;
  }

  function visibleRows() {
    var list = data.rows.filter(matches);
    var dir = state.dir;
    var key = state.sort;
    list.sort(function (a, b) {
      var av = valueOf(a, key);
      var bv = valueOf(b, key);
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return a.rank - b.rank;
    });
    return list;
  }

  function renderLeaders(list) {
    leaders.textContent = '';
    var top = list.slice().sort(function (a, b) { return a.rank - b.rank; }).slice(0, 6);
    if (top.length === 0) return;
    var max = top[0].implied_value_usd || 1;
    top.forEach(function (row) {
      var width = Math.max(4, Math.round((row.implied_value_usd / max) * 100));
      var leader = el('button', { type: 'button', class: 'leader', 'data-slug': row.slug },
        el('b', { text: row.name }),
        el('span', { class: 'bar' }, el('span', { style: 'width:' + width + '%' })),
        el('em', { text: money(row.implied_value_usd) })
      );
      leader.addEventListener('click', function () { select(row.slug); });
      leaders.appendChild(leader);
    });
  }

  function renderTable(list) {
    board.textContent = '';
    if (list.length === 0) {
      board.appendChild(el('tr', null, el('td', { class: 'empty', colspan: '8', text: 'No protocol matches this filter.' })));
      return;
    }
    list.forEach(function (row) {
      var changeClass = row.change_7d == null ? '' : (row.change_7d >= 0 ? 'up' : 'down');
      var tr = el('tr', { 'data-slug': row.slug, 'aria-selected': state.selected === row.slug ? 'true' : 'false' },
        el('td', { class: 'num', text: String(row.rank) }),
        el('td', null, el('span', { class: 'name', text: row.name }), el('span', { class: 'slug', text: row.slug })),
        el('td', null,
          el('span', { class: 'stamp ' + row.lane, text: row.lane === 'unlaunched' ? 'No token' : 'Token recorded' }),
          row.on_watchlist ? el('span', { class: 'floor', text: 'FLOOR' }) : null
        ),
        el('td', { text: row.category || 'Uncategorised' }),
        el('td', { class: 'num', text: money(row.tvl_usd) }),
        el('td', { class: 'num ' + changeClass, text: pct(row.change_7d) }),
        el('td', { class: 'num', text: ageText(row.age_days) }),
        el('td', { class: 'num', text: fullMoney(row.implied_value_usd) })
      );
      tr.addEventListener('click', function () { select(row.slug); });
      board.appendChild(tr);
    });
  }

  function factorRows(row) {
    var lines = [
      ['TVL', fullMoney(row.tvl_usd)],
      [row.lane === 'unlaunched' ? 'Launch multiple' : 'Residual multiple', String(row.multiple)],
      ['Structure', String(row.structure)],
      ['Growth', String(row.growth) + ' from ' + pct(row.growth_input)],
      ['Breadth', String(row.breadth) + ' across ' + ((row.chains && row.chains.length) || 0) + ' chains'],
      ['Confidence', String(row.confidence)]
    ];
    if (row.lane === 'unlaunched') lines.splice(3, 0, ['Tenure', String(row.tenure) + (row.age_days == null ? ' (age unreported, curve uses 300 days)' : ' (' + row.age_days + ' days listed)')]);
    if (row.lane === 'recorded') {
      lines.push(['Gap', row.gap == null ? 'n/a' : String(row.gap)]);
      lines.push(['Season left', row.season == null ? 'n/a' : String(row.season)]);
    }
    return lines;
  }

  function renderDetail(row) {
    detail.textContent = '';
    if (!row) {
      detail.appendChild(el('p', { class: 'quiet', text: 'Select a protocol. The sheet shows the snapshot figures, each valuation factor, and the farm plan with its cost and time.' }));
      return;
    }
    var chains = (row.chains && row.chains.length) ? row.chains.join(', ') : 'none listed';
    detail.appendChild(el('div', { class: 'kicker' },
      el('span', { class: 'stamp ' + row.lane, text: row.lane === 'unlaunched' ? 'Records no token' : 'Token already recorded' }),
      row.on_watchlist ? el('span', { class: 'stamp', text: 'On the floor list' }) : el('span', { class: 'stamp', text: 'Off the floor list' })
    ));
    detail.appendChild(el('h2', { text: row.name }));
    detail.appendChild(el('p', { class: 'slug', text: row.slug + ' · rank ' + row.rank }));
    var parts = [fullMoney(row.tvl_usd), String(row.multiple), String(row.structure)];
    if (row.lane === 'unlaunched') parts.push(String(row.tenure));
    parts.push(String(row.growth), String(row.breadth), String(row.confidence));
    if (row.lane === 'recorded') parts.push(String(row.gap), String(row.season));
    detail.appendChild(el('div', { class: 'sheet' },
      el('strong', { text: fullMoney(row.implied_value_usd) }),
      el('p', { text: parts.join(' × ') }),
      el('p', { text: row.lane === 'unlaunched'
        ? 'Implied launch value if this record stayed as it is. Full-book rank ' + row.rank + '.'
        : 'Residual farm value. A token is already recorded, so this is not a launch claim. Full-book rank ' + row.rank + '.' })
    ));

    var fig = el('table', { class: 'figures' });
    [
      ['Category', row.category || 'Uncategorised'],
      ['TVL', fullMoney(row.tvl_usd)],
      ['7-day TVL', pct(row.change_7d)],
      ['Listed', row.listed_at || 'unreported'],
      ['Age', row.age_days == null ? 'unreported' : row.age_days + ' days'],
      ['Market cap', row.mcap_usd == null ? 'none recorded' : fullMoney(row.mcap_usd)],
      ['Symbol', row.symbol || 'none recorded'],
      ['CoinGecko id', row.gecko_id || 'none recorded'],
      ['Chains', chains]
    ].forEach(function (pair) {
      fig.appendChild(el('tr', null, el('th', { text: pair[0] }), el('td', { text: pair[1] })));
    });
    detail.appendChild(fig);

    detail.appendChild(el('h3', { text: 'Valuation' }));
    var factors = el('table', { class: 'factors' });
    factorRows(row).forEach(function (pair) {
      factors.appendChild(el('tr', null, el('th', { text: pair[0] }), el('td', { text: pair[1] })));
    });
    detail.appendChild(factors);
    var notes = el('ul', { class: 'notes' });
    (row.structure_notes || []).forEach(function (note) {
      notes.appendChild(el('li', { text: note }));
    });
    detail.appendChild(notes);

    detail.appendChild(el('h3', { text: 'Farm plan' }));
    var steps = el('ol', { class: 'steps' });
    (row.farm_steps || []).forEach(function (text, index) {
      steps.appendChild(el('li', null, el('b', { text: 'Step ' + (index + 1) }), text));
    });
    detail.appendChild(steps);
  }

  function paint() {
    var list = visibleRows();
    var selectedVisible = list.some(function (row) { return row.slug === state.selected; });
    if ((!state.selected || !selectedVisible) && list.length) state.selected = list[0].slug;
    var label = 'Showing ' + list.length + ' of ' + data.rows.length + ' protocols.';
    count.textContent = label;
    renderLeaders(list);
    renderTable(list);
    var selected = null;
    if (state.selected) {
      for (var i = 0; i < data.rows.length; i++) if (data.rows[i].slug === state.selected) selected = data.rows[i];
    }
    renderDetail(selected);
  }

  function select(slug) {
    state.selected = slug;
    if (history.replaceState) history.replaceState(null, '', '#' + encodeURIComponent(slug));
    paint();
    var node = detail.querySelector('h2');
    if (node) node.focus && node.setAttribute('tabindex', '-1');
  }

  document.getElementById('q').addEventListener('input', function (event) {
    state.q = event.target.value.trim().toLowerCase();
    paint();
  });
  document.getElementById('category').addEventListener('change', function (event) {
    state.category = event.target.value;
    paint();
  });
  document.getElementById('chain').addEventListener('change', function (event) {
    state.chain = event.target.value;
    paint();
  });
  document.getElementById('rising').addEventListener('change', function (event) {
    state.rising = event.target.checked;
    paint();
  });
  document.querySelectorAll('.lanes button').forEach(function (button) {
    button.addEventListener('click', function () {
      state.lane = button.getAttribute('data-lane');
      document.querySelectorAll('.lanes button').forEach(function (other) {
        other.setAttribute('aria-pressed', other === button ? 'true' : 'false');
      });
      paint();
    });
  });
  document.querySelectorAll('th button').forEach(function (button) {
    button.addEventListener('click', function () {
      var key = button.getAttribute('data-sort');
      if (state.sort === key) state.dir = -state.dir;
      else {
        state.sort = key;
        state.dir = key === 'name' || key === 'category' || key === 'lane' || key === 'rank' ? 1 : -1;
      }
      paint();
    });
  });

  var params = new URLSearchParams(location.search);
  var laneParam = params.get('lane');
  if (laneParam === 'unlaunched' || laneParam === 'watchlist' || laneParam === 'recorded' || laneParam === 'all') {
    state.lane = laneParam;
  }
  var categoryParam = params.get('category');
  if (categoryParam) {
    state.category = categoryParam;
    document.getElementById('category').value = categoryParam;
  }
  var chainParam = params.get('chain');
  if (chainParam) {
    state.chain = chainParam;
    document.getElementById('chain').value = chainParam;
  }
  var queryParam = params.get('q');
  if (queryParam) {
    state.q = queryParam.trim().toLowerCase();
    document.getElementById('q').value = queryParam;
  }
  if (params.get('rising') === '1') {
    state.rising = true;
    document.getElementById('rising').checked = true;
  }
  document.querySelectorAll('.lanes button').forEach(function (button) {
    button.setAttribute('aria-pressed', button.getAttribute('data-lane') === state.lane ? 'true' : 'false');
  });
  var hash = decodeURIComponent((location.hash || '').replace(/^#/, ''));
  if (hash && data.rows.some(function (row) { return row.slug === hash; })) {
    state.selected = hash;
    if (!params.get('lane')) {
      state.lane = 'all';
      document.querySelectorAll('.lanes button').forEach(function (button) {
        button.setAttribute('aria-pressed', button.getAttribute('data-lane') === 'all' ? 'true' : 'false');
      });
    }
  }
  paint();
})();
