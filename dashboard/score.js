// Field Glass valuation. One file, shared by main.ts and the page.
// A protocol records no token when both gecko_id and symbol are null.
// Unlaunched implied value is a launch claim from TVL, 7-day TVL change,
// and days listed without a token. A recorded token uses a residual farm
// multiple instead, so the two lanes are not the same number.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  root.FieldScore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var LAUNCH_MULTIPLE = 0.22;
  var RESIDUAL_MULTIPLE = 0.018;
  var UNKNOWN_PRICE_GAP = 0.35;
  var UNKNOWN_AGE_DAYS = 300;
  var DAY_MS = 86400000;

  // Category scales are properties of the snapshot's category string.
  // They are not a list of protocol slugs.
  var CATEGORY_SCALE = {
    'CEX': 0.02,
    'Bridge': 0.04,
    'Canonical Bridge': 0.04,
    'Cross Chain Bridge': 0.04,
    'Liquid Staking': 0.1,
    'Liquid Restaking': 0.1,
    'Restaked BTC': 0.1,
    'Staking Pool': 0.12,
    'Anchor BTC': 0.08,
    'Decentralized BTC': 0.08
  };

  var EXCHANGE_PREFIX = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];
  var VERSION_TAIL = /\s(?:V\d+(?:\.\d+)?|v\d+(?:\.\d+)?|\d+\.\d+)$/;
  var RECEIPT_WORD = /\b(?:wrapped|staked|staking)\b/i;

  function round4(n) {
    return Math.round(n * 10000) / 10000;
  }

  function clamp(n, lo, hi) {
    return Math.max(lo, Math.min(hi, n));
  }

  function ageDays(asOf, listedAt) {
    if (typeof listedAt !== 'string' || typeof asOf !== 'string') return null;
    var a = Date.parse(asOf + 'T00:00:00Z');
    var b = Date.parse(listedAt + 'T00:00:00Z');
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    return Math.max(0, Math.floor((a - b) / DAY_MS));
  }

  function recordsNoToken(p) {
    return p.gecko_id == null && p.symbol == null;
  }

  function structureOf(name, category) {
    var factor = 1;
    var notes = [];
    var scale = CATEGORY_SCALE[category || ''];
    if (scale) {
      factor *= scale;
      notes.push('Category ' + category + ' is a bridge, an exchange book, or a receipt on an asset that already trades, so structure is ' + scale + '.');
    }
    if (RECEIPT_WORD.test(name || '')) {
      factor *= 0.2;
      notes.push('The name contains wrapped, staked, or staking as a whole word, so structure is multiplied by 0.2.');
    }
    if (VERSION_TAIL.test(name || '')) {
      factor *= 0.45;
      notes.push('The name ends in a version marker, so this is a release of another protocol and structure is multiplied by 0.45.');
    }
    for (var i = 0; i < EXCHANGE_PREFIX.length; i++) {
      var pre = EXCHANGE_PREFIX[i];
      if (name === pre || (typeof name === 'string' && name.indexOf(pre + ' ') === 0)) {
        factor *= 0.08;
        notes.push('The name begins with ' + pre + ', an exchange prefix, so structure is multiplied by 0.08.');
        break;
      }
    }
    if (notes.length === 0) notes.push('No wrapper category, version suffix, or exchange prefix, so structure stays 1.');
    return { factor: round4(factor), notes: notes };
  }

  // Tenure without a token peaks near 450 days: long enough to be real,
  // short of a protocol that has run for years and never launched.
  function tenureOf(age) {
    var days = age == null ? UNKNOWN_AGE_DAYS : Math.max(0, age);
    var x = (days - 450) / 380;
    var bell = Math.exp(-0.5 * x * x);
    return round4(0.62 + 0.53 * bell);
  }

  function growthOf(change) {
    var missing = !(typeof change === 'number' && Number.isFinite(change));
    var clamped = missing ? 0 : clamp(change, -35, 60);
    return {
      input: missing ? null : change,
      clamped: clamped,
      factor: round4(1 + 0.45 * Math.tanh(clamped / 18))
    };
  }

  function breadthOf(chains) {
    var n = Array.isArray(chains) && chains.length > 0 ? chains.length : 1;
    return round4(1 + Math.min(6, Math.max(0, n - 1)) * 0.025);
  }

  function confidenceOf(tvl) {
    var t = Math.log10(Math.max(tvl, 1) / 5000000);
    return round4(0.85 + 0.15 * clamp(t / 2, 0, 1));
  }

  // Share of TVL that a recorded market cap has not already covered.
  function gapOf(tvl, mcap) {
    if (!(typeof mcap === 'number' && mcap > 0)) return UNKNOWN_PRICE_GAP;
    return round4(tvl / (tvl + mcap));
  }

  // A token that has already traded for years leaves less incentive season.
  function seasonOf(age) {
    if (age == null) return 0.9;
    var u = clamp(age, 0, 1095) / 1095;
    return round4(1.12 - 0.5 * u);
  }

  function scoreProtocol(p, asOf) {
    var lane = recordsNoToken(p) ? 'unlaunched' : 'recorded';
    var age = ageDays(asOf, p.listed_at);
    var structure = structureOf(p.name, p.category);
    var growth = growthOf(p.change_7d);
    var breadth = breadthOf(p.chains);
    var confidence = confidenceOf(p.tvl_usd);
    var tenure = lane === 'unlaunched' ? tenureOf(age) : 1;
    var multiple = lane === 'unlaunched' ? LAUNCH_MULTIPLE : RESIDUAL_MULTIPLE;
    var gap = lane === 'recorded' ? gapOf(p.tvl_usd, p.mcap_usd) : 1;
    var season = lane === 'recorded' ? seasonOf(age) : 1;
    var raw = p.tvl_usd * multiple * structure.factor * tenure * growth.factor * breadth * confidence * gap * season;
    var implied = Math.max(1, Math.round(raw));
    if (implied > 100000000000000) implied = 100000000000000;
    return {
      lane: lane,
      age_days: age,
      multiple: multiple,
      structure: structure.factor,
      structure_notes: structure.notes,
      tenure: tenure,
      growth: growth.factor,
      growth_input: growth.input,
      growth_clamped: growth.clamped,
      breadth: breadth,
      confidence: confidence,
      gap: lane === 'recorded' ? gap : null,
      season: lane === 'recorded' ? season : null,
      implied_value_usd: implied
    };
  }

  function gasDollars(chain) {
    var c = (chain || '').toLowerCase();
    if (!c) return 4;
    if (c.indexOf('ethereum') === 0) return 9;
    if (c.indexOf('bitcoin') === 0) return 6;
    if (c.indexOf('solana') >= 0 || c.indexOf('sui') >= 0 || c.indexOf('aptos') >= 0 || c.indexOf('tron') >= 0) return 1;
    if (c.indexOf('arbitrum') >= 0 || c.indexOf('optimism') >= 0 || c.indexOf('base') === 0 || c.indexOf('polygon') >= 0 || c.indexOf('avalanche') >= 0 || c.indexOf('hyperliquid') >= 0) return 2;
    return 3;
  }

  function capitalDollars(tvl, lane, structure) {
    var raw = Math.round(Math.sqrt(Math.max(tvl, 1)) / 65);
    var lo = lane === 'recorded' || structure < 0.25 ? 25 : 50;
    var hi = lane === 'recorded' ? 160 : (structure < 0.25 ? 80 : 350);
    return clamp(raw, lo, hi);
  }

  function holdDays(age, lane) {
    if (lane === 'recorded') return age != null && age < 180 ? 21 : 12;
    if (age == null) return 30;
    if (age < 150) return 45;
    if (age < 700) return 30;
    return 21;
  }

  function playbook(category, lane) {
    var c = (category || '').toLowerCase();
    if (lane === 'recorded') return 'recorded';
    if (c.indexOf('cex') >= 0) return 'cex';
    if (c.indexOf('bridge') >= 0) return 'bridge';
    if (c.indexOf('stak') >= 0 || c.indexOf('restak') >= 0) return 'stake';
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'lend';
    if (c.indexOf('dex') >= 0) return 'dex';
    if (c.indexOf('deriv') >= 0 || c.indexOf('basis') >= 0 || c.indexOf('option') >= 0 || c.indexOf('perp') >= 0) return 'perps';
    if (c.indexOf('rwa') >= 0 || c.indexOf('payment') >= 0) return 'rwa';
    if (c.indexOf('insur') >= 0) return 'insure';
    if (c.indexOf('predict') >= 0) return 'predict';
    if (c.indexOf('yield') >= 0 || c.indexOf('farm') >= 0 || c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('vault') >= 0) return 'vault';
    return 'deposit';
  }

  function chainLabel(chains) {
    if (!Array.isArray(chains) || chains.length === 0) return 'the chain it lists';
    if (chains.length === 1) return chains[0];
    return chains[0] + ' (plus ' + (chains.length - 1) + ' other chains on the record)';
  }

  function money(n) {
    return '$' + String(Math.round(n));
  }

  function changePhrase(change) {
    if (!(typeof change === 'number' && Number.isFinite(change))) return 'no seven-day TVL change on the record';
    var sign = change > 0 ? '+' : '';
    return 'a seven-day TVL change of ' + sign + change + '%';
  }

  function step(action, cost, time) {
    var text = String(action).replace(/\s+/g, ' ').trim();
    var full = text + ' Cost: ' + cost + '. Time: ' + time + '.';
    if (full.length > 600) full = full.slice(0, 579).trim() + ' Cost: ' + cost + '. Time: ' + time + '.';
    return full;
  }

  function openAction(book, name, chain, capital, gas) {
    if (book === 'lend') {
      return 'Supply ' + money(capital) + ' of USDC to ' + name + ' on ' + chain + ', then borrow about ' + money(Math.round(capital * 0.2)) + ' against it and leave both legs open.';
    }
    if (book === 'dex') {
      return 'Add ' + money(capital) + ' of liquidity to the deepest ' + name + ' pool on ' + chain + ', split about half USDC and half the pool\'s other asset.';
    }
    if (book === 'perps') {
      return 'Post ' + money(capital) + ' of USDC as margin on ' + name + ' on ' + chain + ' and open one hedge sized to about 10% of that margin.';
    }
    if (book === 'stake') {
      return 'Stake ' + money(capital) + ' of the staking asset ' + name + ' accepts on ' + chain + ' and keep the receipt in the same address.';
    }
    if (book === 'rwa') {
      return 'Subscribe ' + money(capital) + ' of USDC to the yield asset ' + name + ' offers on ' + chain + ' and keep the position token.';
    }
    if (book === 'bridge') {
      return 'Bridge ' + money(capital) + ' of USDC through ' + name + ' onto ' + chain + ' and leave the bridged balance there.';
    }
    if (book === 'cex') {
      return 'Deposit ' + money(capital) + ' of USDC to your own account at ' + name + ' and place one small spot trade, then leave the balance on the account.';
    }
    if (book === 'insure') {
      return 'Buy cover from ' + name + ' on ' + chain + ' with a ' + money(capital) + ' payout and pay the premium from the same address.';
    }
    if (book === 'predict') {
      return 'Fund ' + name + ' with ' + money(capital) + ' on ' + chain + ' and take one side of a single market with a limit order.';
    }
    if (book === 'recorded') {
      return 'Deposit ' + money(capital) + ' of USDC into ' + name + ' on ' + chain + '. The record already has a token, so this is a usage position, not a launch position.';
    }
    if (book === 'vault') {
      return 'Deposit ' + money(capital) + ' of USDC into the ' + name + ' vault on ' + chain + ' and keep the vault shares in the same address.';
    }
    return 'Deposit ' + money(capital) + ' of USDC into ' + name + ' on ' + chain + ' and keep the receipt in the same address.';
  }

  function farmPlan(row) {
    var chain = chainLabel(row.chains);
    var primary = Array.isArray(row.chains) && row.chains.length ? row.chains[0] : '';
    var gas = gasDollars(primary);
    var capital = capitalDollars(row.tvl_usd, row.lane, row.structure);
    var hold = holdDays(row.age_days, row.lane);
    var book = playbook(row.category, row.lane);
    var ageText = row.age_days == null ? 'an unreported listing date' : (row.age_days + ' days listed by the snapshot date');
    var weekly = Math.max(hold / 7, 1);
    var steps = [
      step(
        'Send ' + money(gas * 3) + ' of the gas asset to a fresh address that will hold only the ' + row.name + ' position on ' + chain + '.',
        money(gas * 3) + ' of gas inventory and no protocol fee',
        '10 minutes'
      ),
      step(
        'Read the snapshot line for ' + row.name + ': TVL ' + money(row.tvl_usd) + ' and ' + changePhrase(row.change_7d) + '. Set the deposit at ' + money(capital) + ' and leave that size, because the seven-day change is already inside the implied value.',
        'no dollars beyond the ' + money(capital) + ' deposit',
        '5 minutes to read the figures before funding'
      ),
      step(
        'Move ' + money(capital) + ' of USDC onto ' + chain + ' from an account you already control, and wait for one confirmation before opening ' + row.name + '.',
        money(capital) + ' of working capital plus about ' + money(gas) + ' of transfer gas',
        '15 to 40 minutes'
      ),
      step(
        openAction(book, row.name, chain, capital, gas),
        money(capital) + ' stays in the position and the transaction costs about ' + money(gas) + ' of gas',
        '20 minutes'
      )
    ];
    if (book === 'lend' || book === 'dex' || book === 'perps') {
      steps.push(step(
        'On the next day, check that the ' + row.name + ' position is still open and that the borrowed, pooled, or hedged leg is within 5% of the size you set.',
        'about ' + money(gas) + ' of gas if you need to adjust, otherwise nothing',
        '10 minutes the next day'
      ));
    }
    steps.push(step(
      'Once each week, send one small transaction that ' + row.name + ' can count, such as claiming a reward the app already shows or adding and removing ' + money(20) + '.',
      'about ' + money(gas) + ' of gas a week for roughly ' + Math.ceil(weekly) + ' weeks',
      '10 minutes a week'
    ));
    steps.push(step(
      'Leave the ' + money(capital) + ' position open for ' + hold + ' days. The snapshot age used for that window is ' + ageText + '.',
      'the ' + money(capital) + ' is unavailable for ' + hold + ' days',
      hold + ' days'
    ));
    steps.push(step(
      'After ' + hold + ' days, withdraw back to USDC on ' + chain + ', write down the address, the open date, the close date, and the gas paid, and stop.',
      'about ' + money(Math.max(gas, 1)) + ' of gas to exit and no extra capital',
      '15 minutes'
    ));
    return steps;
  }

  function bySlug(a, b) {
    if (a.slug < b.slug) return -1;
    if (a.slug > b.slug) return 1;
    return 0;
  }

  function rankBook(snapshot) {
    var watch = Object.create(null);
    for (var i = 0; i < snapshot.watchlist.length; i++) watch[snapshot.watchlist[i]] = true;
    var rows = [];
    for (var j = 0; j < snapshot.protocols.length; j++) {
      var p = snapshot.protocols[j];
      var scored = scoreProtocol(p, snapshot.as_of);
      var row = {
        slug: p.slug,
        name: p.name,
        category: p.category,
        chains: p.chains,
        tvl_usd: p.tvl_usd,
        change_7d: p.change_7d,
        mcap_usd: p.mcap_usd,
        listed_at: p.listed_at,
        gecko_id: p.gecko_id,
        symbol: p.symbol,
        on_watchlist: watch[p.slug] === true,
        lane: scored.lane,
        age_days: scored.age_days,
        multiple: scored.multiple,
        structure: scored.structure,
        structure_notes: scored.structure_notes,
        tenure: scored.tenure,
        growth: scored.growth,
        growth_input: scored.growth_input,
        growth_clamped: scored.growth_clamped,
        breadth: scored.breadth,
        confidence: scored.confidence,
        gap: scored.gap,
        season: scored.season,
        implied_value_usd: scored.implied_value_usd
      };
      row.farm_steps = farmPlan(row);
      rows.push(row);
    }
    rows.sort(function (a, b) {
      return b.implied_value_usd - a.implied_value_usd || bySlug(a, b);
    });
    for (var r = 0; r < rows.length; r++) rows[r].rank = r + 1;
    return rows;
  }

  function confirmScores(snapshot, rows) {
    var by = Object.create(null);
    for (var i = 0; i < snapshot.protocols.length; i++) by[snapshot.protocols[i].slug] = snapshot.protocols[i];
    for (var j = 0; j < rows.length; j++) {
      var row = rows[j];
      var again = scoreProtocol(by[row.slug], snapshot.as_of);
      if (!again || again.implied_value_usd !== row.implied_value_usd || again.lane !== row.lane) return row.slug;
      var plan = farmPlan(row);
      if (plan.length !== row.farm_steps.length) return row.slug;
      for (var s = 0; s < plan.length; s++) if (plan[s] !== row.farm_steps[s]) return row.slug;
    }
    return null;
  }

  function auditBook(rows, snapshot) {
    if (!Array.isArray(rows) || rows.length < 100 || rows.length > 4000) return 'row count ' + (rows && rows.length);
    var seen = Object.create(null);
    var watchHit = Object.create(null);
    var off = 0;
    var first = rows[0] ? rows[0].implied_value_usd : null;
    var same = true;
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      if (!row || typeof row.slug !== 'string' || /\s/.test(row.slug) || row.slug.length < 1 || row.slug.length > 128) return 'bad slug at ' + i;
      if (seen[row.slug]) return 'duplicate ' + row.slug;
      seen[row.slug] = true;
      if (typeof row.name !== 'string' || row.name.trim() === '') return 'empty name ' + row.slug;
      if (row.rank !== i + 1) return 'rank ' + row.rank + ' at position ' + (i + 1);
      if (!Number.isSafeInteger(row.implied_value_usd) || row.implied_value_usd < 1 || row.implied_value_usd > 100000000000000) return 'implied ' + row.slug;
      if (i > 0 && row.implied_value_usd > rows[i - 1].implied_value_usd) return 'order ' + row.slug;
      if (row.implied_value_usd !== first) same = false;
      if (!Array.isArray(row.farm_steps) || row.farm_steps.length < 3 || row.farm_steps.length > 12) return 'steps ' + row.slug;
      for (var s = 0; s < row.farm_steps.length; s++) {
        var text = String(row.farm_steps[s]).trim();
        if (text.length < 20 || text.length > 600) return 'step length ' + text.length + ' on ' + row.slug;
        if (text.indexOf('Cost:') < 0 || text.indexOf('Time:') < 0) return 'step missing cost or time on ' + row.slug;
      }
      if (row.on_watchlist) watchHit[row.slug] = true;
      else off += 1;
    }
    if (same) return 'every implied value is identical';
    for (var w = 0; w < snapshot.watchlist.length; w++) {
      if (!watchHit[snapshot.watchlist[w]]) return 'missing watchlist ' + snapshot.watchlist[w];
    }
    if (off < 60) return 'only ' + off + ' off-list rows';
    var known = Object.create(null);
    for (var p = 0; p < snapshot.protocols.length; p++) known[snapshot.protocols[p].slug] = true;
    for (var k = 0; k < rows.length; k++) if (!known[rows[k].slug]) return 'invented ' + rows[k].slug;
    return null;
  }

  function readSnapshot(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('snapshot is not an object');
    if (typeof raw.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw.as_of)) throw new Error('snapshot as_of is missing');
    if (typeof raw.source !== 'string') throw new Error('snapshot source is missing');
    if (typeof raw.floor_usd !== 'number' || !Number.isFinite(raw.floor_usd)) throw new Error('snapshot floor_usd is missing');
    if (!Array.isArray(raw.protocols) || !Array.isArray(raw.watchlist)) throw new Error('snapshot protocols or watchlist is missing');
    var protocols = raw.protocols.map(function (p, i) {
      if (!p || typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
        throw new Error('protocol ' + i + ' lacks slug, name, or tvl');
      }
      return {
        slug: p.slug,
        name: p.name,
        category: typeof p.category === 'string' ? p.category : null,
        chains: Array.isArray(p.chains) ? p.chains.filter(function (c) { return typeof c === 'string'; }) : [],
        tvl_usd: p.tvl_usd,
        change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
        mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
        listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
        gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
        symbol: typeof p.symbol === 'string' ? p.symbol : null
      };
    });
    return {
      as_of: raw.as_of,
      source: raw.source,
      floor_usd: raw.floor_usd,
      protocols: protocols,
      watchlist: raw.watchlist.filter(function (s) { return typeof s === 'string'; })
    };
  }

  return {
    LAUNCH_MULTIPLE: LAUNCH_MULTIPLE,
    RESIDUAL_MULTIPLE: RESIDUAL_MULTIPLE,
    scoreProtocol: scoreProtocol,
    farmPlan: farmPlan,
    rankBook: rankBook,
    auditBook: auditBook,
    confirmScores: confirmScores,
    readSnapshot: readSnapshot
  };
});
