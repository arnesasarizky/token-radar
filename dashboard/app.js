/* Token Radar dashboard. Reads window.RADAR (data.js, written beside this folder by main.ts) and
   renders the ranked pre-token board, a per-protocol detail view with the model's own inputs and
   farm plan, and the live peer set the multiples come from. No fetch, no network: every byte it
   shows arrives in data.js. The farm plans are generated here by the same playbook method the
   model uses for board.json, so a protocol's page and its board row tell the same story. */
(function () {
  'use strict';

  var R = window.RADAR;
  var WATCHLIST = new Set([
    'armitage-by-wintermute', 'axis', 'b14g', 'bittensor-dtao', 'clearstar', 'curvance',
    'doppler-finance', 'ember', 'firelight', 'galaxy-curation', 'gami-labs', 'gauntlet',
    'hive-protocol', 'hyperithm', 'infinifi', 'k3-capital', 'keyrock', 'lagoon',
    'lightning-network', 'lofty', 'mezo-earn', 'noble', 'nonce-capital', 'onre', 'opentrade',
    'plume-vaults', 'r25', 'reti-pooling', 'rockawayx', 'saturn', 'steakhouse-financial',
    'symbiotic', 'tori-finance', 'tulipa-capital', 'tydro', 'upshift', 'usdd', 'valos',
    'veda', 'yuzu-money'
  ]);

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(v) {
    if (v == null) return '—';
    if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
    if (v >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
    if (v >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K';
    return '$' + v;
  }
  function moneyFull(v) {
    return v == null ? '—' : '$' + Math.round(v).toLocaleString('en-US');
  }
  function pct(v) {
    if (v == null) return '—';
    return (v > 0 ? '+' : '') + v.toFixed(1) + '%';
  }
  function mult(x) { return x == null ? '—' : x.toFixed(3) + '×'; }
  function factor(x) { return x == null ? '—' : '×' + x.toFixed(3); }

  /* ---- The farm-plan generator: the model's playbook method, run in the page. ---- */

  function slugHash(slug) {
    var h = 0x811c9dc5;
    for (var i = 0; i < slug.length; i++) {
      h ^= slug.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }
  function pick(variants, hash, shift) { return variants[(hash >>> shift) % variants.length]; }
  function fill(t, name, chain, cap) {
    return t.split('{name}').join(name).split('{chain}').join(chain).split('{cap}').join(cap);
  }
  function chainOf(p) { return p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 100000000) return '$1,000-$5,000';
    if (p.tvl_usd >= 25000000) return '$500-$2,000';
    return '$100-$500';
  }
  function gasFor(chain) {
    var c = chain.toLowerCase();
    if (c === 'ethereum') return 'budget $15-$40 a week in mainnet gas while you are active';
    if (c === 'solana') return 'network fees come to roughly $0.50 a week';
    if (c.indexOf('base') >= 0 || c.indexOf('arbitrum') >= 0 || c.indexOf('optimism') >= 0 || c.indexOf('op mainnet') >= 0) return 'gas runs about $1-$5 a week on this L2';
    if (c === 'bitcoin') return 'bitcoin network fees run a few dollars per transaction';
    return 'fees on ' + chain + ' are low, a few dollars a week at most';
  }

  var PLAYBOOKS = {
    dex: {
      open: [
        'Make {name} your regular swap venue on {chain}: route the trades you would make anyway through its pools, and open a {cap} position in its busiest stablecoin pair.',
        "Open a {cap} liquidity position in {name}'s main pool on {chain} and leave it in range; a wide range keeps counting while a tight one drifts out and stops."
      ],
      deepen: [
        "Swap in both directions at least twice a week, in and out of the pool's main pair, so the wallet shows genuine flow rather than a single parked deposit.",
        "Take part in any gauge or governance vote the app runs, and claim trading-fee rewards from {name}'s own rewards page as they build up."
      ]
    },
    lend: {
      open: [
        "Supply {cap} of USDC or ETH to {name}'s main lending market on {chain} and leave it supplied; lenders who stay in across weekly snapshots are the wallets a protocol can actually see.",
        'Deposit {cap} into {name} on {chain} as a lender and resist topping up or pulling out for the first month; a steady balance reads as a user, not a passer-by.'
      ],
      deepen: [
        'Borrow a small slice, 10-20% of your deposit, against the position and repay it inside the week; one clean borrow-and-repay cycle shows you used the market, not just parked in it.',
        "Claim any lender rewards the app shows, then supply them back into the same market so your supplied balance keeps compounding on {name}'s own books."
      ]
    },
    cdp: {
      open: [
        "Open a vault on {name} with {cap} of collateral on {chain} and mint a modest amount of its stablecoin, keeping the collateral ratio well clear of the liquidation line.",
        'Lock {cap} of collateral in a {name} vault on {chain} and mint against it conservatively; the position only counts while it stays safely open.'
      ],
      deepen: [
        "Hold the minted stablecoin, or supply it to the protocol's own stability pool, and top the collateral up whenever the ratio drifts toward the minimum.",
        'Repay a little and mint again over the weeks so the vault shows a living history of both sides of the product, not a single forgotten transaction.'
      ]
    },
    yield: {
      open: [
        "Deposit {cap} into {name}'s flagship vault on {chain} and keep the vault shares in the same wallet; auto-compounding vaults reward wallets that simply stay put.",
        'Put {cap} to work in {name} on {chain} through its main vault and leave the shares untouched; churning between vaults resets more than it earns.'
      ],
      deepen: [
        'Claim whatever the vault pays each week and re-deposit it instead of selling, so your share balance grows on the protocol\'s own records month after month.',
        "Once a month, read the vault's strategy note and confirm the underlying markets are still ones you accept; move only if the strategy itself changes."
      ]
    },
    curator: {
      open: [
        "Choose one of {name}'s curated vaults on {chain} and deposit {cap}; read the vault's strategy page first, so you know which markets your money is being routed into.",
        'Deposit {cap} into a {name} vault on {chain} whose curator and strategy you can name; curated vaults track depositors per vault, not per protocol.'
      ],
      deepen: [
        "Check the vault's allocation page monthly and switch sibling vaults only if the curator changes strategy; steady depositors are far easier to recognise than vault-hoppers.",
        'Compound any yield the vault distributes back into the same vault, keeping one continuous deposit history under one curator.'
      ]
    },
    rwa: {
      open: [
        "Complete {name}'s onboarding or allowlist step if it runs one, then mint {cap} of its tokenised treasury or credit asset on {chain} and hold it in the minting wallet.",
        "Mint {cap} of {name}'s yield-bearing real-world asset on {chain} and hold it where you minted it; these products count holders, and holders are wallets that stay."
      ],
      deepen: [
        "Let the position accrue for a full quarter and claim yield from the app's own dashboard; RWA products settle slowly, so plan redemptions around their windows rather than forcing them.",
        'Add a second, smaller mint after the first settles cleanly, so your history shows a repeat customer rather than a single test transaction.'
      ]
    },
    derivatives: {
      open: [
        'Deposit {cap} of margin on {name} and open one small hedged position, a long and a short of similar size, so you build real trading history without directional risk.',
        'Fund a {cap} margin account on {name} and trade one small position end to end, open to close, before doing anything larger; the venue tracks completed behaviour.'
      ],
      deepen: [
        'Trade a small amount every week, even a $50 position opened and closed, and keep the margin account funded between sessions; consistent small traders are the activity these venues record.',
        "Use one advanced feature the venue offers, a stop order, a sub-account or its API, once a month; depth of use is visible in an account's history."
      ]
    },
    bridge: {
      open: [
        'Bridge {cap} of funds to {chain} through {name} instead of a rival bridge, then actually use the arrived funds in one app on the destination chain before bridging anything back.',
        'Make {name} your route onto {chain}: move {cap} across with it and leave the funds working on the far side for a few weeks, not a few minutes.'
      ],
      deepen: [
        'Make the return trip through {name} as well, a few weeks later; round trips in both directions are the usage a bridge can attribute to a single wallet.',
        'Bridge a second, smaller amount on a different week rather than one large transfer; repeated crossings read as a habit, not an event.'
      ]
    },
    stable: {
      open: [
        "Mint {cap} of {name}'s stablecoin against a deposit on {chain} and hold the stablecoin in the same wallet; an issuer can only see wallets that actually hold its asset.",
        "Acquire {cap} of {name}'s stable asset on {chain} through its own mint or main pool and keep it; holding through several weekly snapshots is the visible behaviour."
      ],
      deepen: [
        "Use the stablecoin once in a partner app {name} lists, a payment or a lending market, then bring it back; circulation, not just minting, is the usage that shows.",
        'Top the holding up slightly each month so the balance trends upward; a growing, held balance is the strongest signal a pre-token issuer can record.'
      ]
    },
    payments: {
      open: [
        'Sign up for {name}, complete its identity check if it asks for one, and fund the account with {cap} so the wallet is fully live long before any token exists.',
        'Open a {name} account and load it with {cap}; finish every verification step it offers, since half-verified accounts are the first ones filtered out of anything.'
      ],
      deepen: [
        'Route one genuine payment or card purchase a week through {name} for a couple of months; small, regular, real transactions are the entire point of a payments product.',
        'Receive one payment through {name} as well as sending them, so the account shows both sides of the network rather than a single funded wallet.'
      ]
    },
    prediction: {
      open: [
        'Fund {cap} on {name} and take small positions in its most liquid markets, the ones you genuinely have a view on, rather than spraying a little into every market listed.',
        'Deposit {cap} on {name} and open two or three small positions in markets you follow; settled, considered trades read very differently from random clicks.'
      ],
      deepen: [
        'Stay active across several market cycles and settle positions as they resolve instead of abandoning them; a settled history is what marks a real user here.',
        'Reinvest a slice of any winnings into the next market you have a view on, keeping one continuous thread of activity in the account.'
      ]
    },
    nft: {
      open: [
        'Connect your wallet to {name} on {chain} and make a first genuine trade or purchase inside a {cap} budget; empty profiles and untouched wallets are trivial to filter out.',
        'Set up your profile on {name} and complete one real transaction on {chain}, a buy, a sale or a mint, sized inside a {cap} budget for the season.'
      ],
      deepen: [
        'List, play or trade a little each week and keep whatever you earn in the same wallet; steady low-value activity over months outweighs one large purchase.',
        'Take part in one seasonal event, drop or quest {name} runs, and finish it fully rather than starting three and abandoning them.'
      ]
    },
    launchpad: {
      open: [
        'Register on {name} and complete any staking or allowlist step it runs, with {cap} held ready; launchpads remember who was prepared before a sale opened, not after.',
        'Create your {name} account, pass its checks, and park {cap} in whatever its next sale requires, so you are eligible the moment a round opens.'
      ],
      deepen: [
        'Take part in one small sale or claim round and hold what you receive for a while instead of flipping it on day one; holders are the participants a launchpad can identify.',
        'Join the allowlist for each new round even when you sit the sale out; repeated registration is a visible, costless signal of a real follower.'
      ]
    },
    indexes: {
      open: [
        "Buy {cap} of {name}'s headline index product on {chain} and hold it in your own wallet rather than on an exchange, so the holding is attributable to you.",
        "Open a {cap} position in {name}'s main index on {chain} and leave it alone; index holders are counted by duration as much as by size."
      ],
      deepen: [
        'Top the position up as the index rebalances each month; holders who ride several rebalances are the ones an index protocol can pick out.',
        'Claim any distribution the index pays and reinvest it into the same product, keeping one unbroken holding history.'
      ]
    },
    staking: {
      open: [
        "Stake {cap} of the chain's native asset through {name} on {chain} and keep the receipt in the same wallet for the whole period.",
        'Delegate {cap} through {name} on {chain} and leave the stake untouched; staking products measure their users in months staked, not transactions.'
      ],
      deepen: [
        'Re-stake or re-delegate rewards as they arrive instead of withdrawing them, and never start an unbonding you do not intend to finish.',
        'Add a small second stake a month later so the position shows growth over time rather than one static deposit.'
      ]
    },
    generic: {
      open: [
        "Deposit {cap} into {name}'s main product on {chain} and keep the position open; whatever this protocol one day counts, it can only count wallets that actually used it.",
        'Start with {cap} in {name} on {chain}, using its headline feature end to end once, properly, rather than poking at every screen it has.'
      ],
      deepen: [
        'Repeat the core action, a deposit, a swap, a vote or a claim, at least once a week, so your history spans months instead of a single afternoon.',
        'Turn on whatever the app itself offers regulars, notifications, a points page, a referral link, and use it the way a genuine user would.'
      ]
    }
  };

  function playbookFor(category) {
    var c = (category || '').toLowerCase();
    if (c === 'dexs') return PLAYBOOKS.dex;
    if (c.indexOf('lend') >= 0 || c === 'collateral markets') return PLAYBOOKS.lend;
    if (c.indexOf('cdp') >= 0) return PLAYBOOKS.cdp;
    if (c === 'yield' || c === 'yield aggregator' || c === 'farm' || c === 'leveraged farming' || c === 'liquidity manager') return PLAYBOOKS.yield;
    if (c === 'risk curators' || c === 'onchain capital allocator' || c === 'collateral management') return PLAYBOOKS.curator;
    if (c === 'rwa') return PLAYBOOKS.rwa;
    if (c === 'derivatives' || c.indexOf('options') >= 0 || c === 'synthetics' || c === 'interest rate derivatives' || c === 'basis trading') return PLAYBOOKS.derivatives;
    if (c === 'cross chain bridge') return PLAYBOOKS.bridge;
    if (c.indexOf('stable') >= 0 || c === 'algo-stables') return PLAYBOOKS.stable;
    if (c === 'payments' || c === 'crypto card issuer') return PLAYBOOKS.payments;
    if (c === 'prediction market') return PLAYBOOKS.prediction;
    if (c.indexOf('nft') >= 0 || c.indexOf('gaming') >= 0) return PLAYBOOKS.nft;
    if (c === 'launchpad') return PLAYBOOKS.launchpad;
    if (c === 'indexes') return PLAYBOOKS.indexes;
    if (c === 'staking pool' || c === 'restaking') return PLAYBOOKS.staking;
    return PLAYBOOKS.generic;
  }

  var SETUP_STEPS = [
    'Create a fresh wallet for this farm and keep its seed phrase written down offline; fund it on {chain} with the working capital plus a little extra held back for fees.',
    'Set up a dedicated wallet, never your main one, and get funds onto {chain} before you touch the app, so a fee spike never strands a half-open position.',
    'Use one wallet for this protocol and label it in your tracker; send it enough on {chain} to cover the position and a month of transaction fees up front.'
  ];
  var ROUTINE_STEPS = [
    'Repeat one qualifying action every week, a swap, a top-up, a vote or a claim, for at least 8-12 weeks; protocols read activity over time, and one busy afternoon rarely counts for much.',
    'Keep the position open and touch it weekly for 8-12 weeks, compounding or topping up rather than withdrawing, so the wallet appears in month after month of the protocol\'s own records.',
    'Set a weekly ten-minute slot to use {name} again: claim, compound, vote or trade small. Eight to twelve weeks of steady use is the pattern that separates farmers from tourists.'
  ];
  var TRACK_STEPS = [
    "Check {name}'s own points or rewards page monthly and claim only through links the protocol itself publishes; if it ever issues a token, this recorded history is what would matter, and nothing is promised.",
    'Keep a simple farm log: wallet, dates, amounts, transaction hashes. If {name} ever launches a token you will want proof of early use; until then, the log is how you unwind the position cleanly.',
    'Never pay anyone to unlock rewards and never type your seed phrase anywhere; when you are done, withdraw through the app itself and move on. A future token is a possibility here, never a guarantee.'
  ];

  function farmSteps(p) {
    var chain = chainOf(p);
    var cap = capitalFor(p);
    var gas = gasFor(chain);
    var hash = slugHash(p.slug);
    var book = playbookFor(p.category);
    return [
      { text: fill(pick(SETUP_STEPS, hash, 0), p.name, chain, cap), cost: 'no position yet, just the fee float; ' + gas, time: '10-15 minutes, once' },
      { text: fill(pick(book.open, hash, 3), p.name, chain, cap), cost: cap + ' of working capital', time: 'about 20 minutes' },
      { text: fill(pick(book.deepen, hash, 6), p.name, chain, cap), cost: 'no new capital; ' + gas, time: '15 minutes' },
      { text: fill(pick(ROUTINE_STEPS, hash, 9), p.name, chain, cap), cost: gas, time: '10 minutes a week for 8-12 weeks' },
      { text: fill(pick(TRACK_STEPS, hash, 12), p.name, chain, cap), cost: 'nothing; never pay anyone to claim', time: '10 minutes a month' }
    ];
  }

  /* ---- Rendering and wiring ---- */

  function $(id) { return document.getElementById(id); }
  var boardBody = $('board-body'), countEl = $('count');
  var viewBoard = $('view-board'), viewDetail = $('view-detail'), viewLive = $('view-live');
  var tabBoard = $('tab-board'), tabLive = $('tab-live');

  var params = new URLSearchParams(location.search);
  var state = {
    q: params.get('q') || '',
    category: params.get('category') || '',
    chain: params.get('chain') || '',
    min: Number(params.get('min') || 0),
    watch: params.get('watch') === '1',
    sort: params.get('sort') || 'rank',
    dir: params.get('dir') || 'asc',
    view: params.get('view') === 'live' ? 'live' : 'board',
    detail: null
  };
  var bySlug = {};
  (R ? R.rows : []).forEach(function (r) { bySlug[r.slug] = r; });

  function fillHeader() {
    document.querySelector('[data-global-multiple]').textContent = mult(R.global_multiple);
    document.querySelector('[data-global-peers]').textContent = String(R.global_peers);
    document.querySelector('[data-stat="board"]').textContent = String(R.board_size);
    document.querySelector('[data-stat="watchlist"]').textContent = String(R.watchlist_size);
    document.querySelector('[data-stat="live"]').textContent = String(R.live_size);
    document.querySelector('[data-stat="asof"]').textContent = R.as_of;
    document.querySelector('[data-stat="version"]').textContent = R.model_version;
  }

  function buildFilterOptions() {
    var cats = {}, chains = {};
    R.rows.forEach(function (r) {
      if (r.category) cats[r.category] = true;
      r.chains.forEach(function (c) { chains[c] = (chains[c] || 0) + 1; });
    });
    var catSel = $('f-category');
    Object.keys(cats).sort().forEach(function (c) {
      var o = document.createElement('option'); o.value = c; o.textContent = c; catSel.appendChild(o);
    });
    var chainSel = $('f-chain');
    Object.keys(chains).sort(function (a, b) { return chains[b] - chains[a] || (a < b ? -1 : 1); }).forEach(function (c) {
      var o = document.createElement('option'); o.value = c; o.textContent = c + ' (' + chains[c] + ')'; chainSel.appendChild(o);
    });
    $('f-q').value = state.q;
    catSel.value = state.category;
    chainSel.value = state.chain;
    if (state.min) $('f-min').value = String(state.min);
    $('f-watch').checked = state.watch;
  }

  var SORTS = {
    rank: function (r) { return r.rank; },
    name: function (r) { return r.name.toLowerCase(); },
    tvl: function (r) { return r.tvl_usd; },
    change: function (r) { return r.change_7d; },
    implied: function (r) { return r.implied_value_usd; }
  };

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    var rows = R.rows.filter(function (r) {
      if (state.watch && !WATCHLIST.has(r.slug)) return false;
      if (state.category && r.category !== state.category) return false;
      if (state.chain && r.chains.indexOf(state.chain) < 0) return false;
      if (state.min && r.tvl_usd < state.min) return false;
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.indexOf(q) < 0) return false;
      return true;
    });
    var get = SORTS[state.sort] || SORTS.rank;
    var dir = state.dir === 'desc' ? -1 : 1;
    rows.sort(function (a, b) {
      var va = get(a), vb = get(b);
      if (va == null && vb == null) return a.rank - b.rank;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (va < vb) return -dir;
      if (va > vb) return dir;
      return a.rank - b.rank;
    });
    return rows;
  }

  function chainText(chains) {
    if (!chains.length) return '—';
    var head = chains.slice(0, 3).join(' · ');
    return chains.length > 3 ? head + ' +' + (chains.length - 3) : head;
  }

  function markSortHeaders() {
    document.querySelectorAll('#board-table th.sortable').forEach(function (th) {
      var key = th.getAttribute('data-sort');
      var label = th.getAttribute('data-label') || th.textContent.replace(/[▲▼]\s*/g, '');
      th.setAttribute('data-label', label);
      if (key === state.sort) {
        th.innerHTML = esc(label) + ' <span class="arrow">' + (state.dir === 'desc' ? '▼' : '▲') + '</span>';
        th.setAttribute('aria-sort', state.dir === 'desc' ? 'descending' : 'ascending');
      } else {
        th.textContent = label;
        th.removeAttribute('aria-sort');
      }
    });
  }

  function renderBoard() {
    var rows = filteredRows();
    markSortHeaders();
    if (!rows.length) {
      boardBody.innerHTML = '<tr><td class="empty" colspan="7">No protocol matches those filters. Loosen one and the radar widens again.</td></tr>';
    } else {
      boardBody.innerHTML = rows.map(function (r) {
        var chg = r.change_7d == null ? '—' : '<span class="' + (r.change_7d >= 0 ? 'up' : 'down') + '">' + pct(r.change_7d) + '</span>';
        return '<tr data-slug="' + esc(r.slug) + '">' +
          '<td class="num rank">' + r.rank + '</td>' +
          '<td><span class="pname">' + esc(r.name) + '</span>' +
          (WATCHLIST.has(r.slug) ? '<span class="badge">Watchlist</span>' : '') +
          '<br><span class="slug">' + esc(r.slug) + '</span></td>' +
          '<td>' + esc(r.category || '—') + '</td>' +
          '<td class="chains">' + esc(chainText(r.chains)) + '</td>' +
          '<td class="num">' + money(r.tvl_usd) + '</td>' +
          '<td class="num">' + chg + '</td>' +
          '<td class="num">' + money(r.implied_value_usd) + '</td></tr>';
      }).join('');
    }
    var filtered = state.q || state.category || state.chain || state.min || state.watch;
    countEl.textContent = 'Showing ' + rows.length + ' of ' + R.rows.length + ' protocols' + (filtered ? ' — filters on' : '');
  }

  function ageText(days) {
    if (days == null) return 'not recorded';
    if (days < 730) return days + ' days';
    return days + ' days (' + (days / 365.25).toFixed(1) + ' years)';
  }

  function renderDetail(r) {
    var catEntry = null;
    R.category_multiples.forEach(function (cm) { if (cm.category === r.category) catEntry = cm; });
    var peerNote;
    if (catEntry && catEntry.median != null) {
      peerNote = 'the ' + esc(r.category) + ' median across ' + catEntry.peers + ' token-bearing peers, shrunk toward the global median';
    } else {
      peerNote = 'the global median across ' + R.global_peers + ' peers — ' + esc(r.category || 'this category') + ' has too few token-bearing peers to set its own';
    }
    var steps = farmSteps(r).map(function (s) {
      return '<li><span class="step-text">' + esc(s.text) + '</span>' +
        '<span class="step-meta"><b>Cost:</b> ' + esc(s.cost) + ' &nbsp;·&nbsp; <b>Time:</b> ' + esc(s.time) + '</span></li>';
    }).join('');
    $('detail-body').innerHTML =
      '<div class="detail-head"><h2>' + esc(r.name) + '</h2>' +
      '<span class="rankline">Rank #' + r.rank + ' of ' + R.board_size + ' · ' + esc(r.slug) + '</span></div>' +
      '<p>' +
      (r.category ? '<span class="tag">' + esc(r.category) + '</span> ' : '') +
      '<span class="tag hot">Pre-token</span> ' +
      (WATCHLIST.has(r.slug) ? '<span class="tag hot">House watchlist</span> ' : '') +
      '<span class="tag">Tracked since ' + esc(r.listed_at || 'not recorded') + '</span>' +
      '</p>' +
      '<div class="detail-grid">' +
      '<div class="card"><h3>Valuation breakdown</h3><dl>' +
      '<div class="kv"><dt>Total value locked</dt><dd>' + moneyFull(r.tvl_usd) + '</dd></div>' +
      '<div class="kv"><dt>Peer multiple</dt><dd>' + mult(r.base_multiple) + '</dd></div>' +
      '<div class="kv"><dt>7-day TVL change</dt><dd>' + pct(r.change_7d) + '</dd></div>' +
      '<div class="kv"><dt>Growth factor</dt><dd>' + factor(r.growth_multiplier) + '</dd></div>' +
      '<div class="kv"><dt>Time without a token</dt><dd>' + ageText(r.age_days) + '</dd></div>' +
      '<div class="kv"><dt>Tokenless-age factor</dt><dd>' + factor(r.maturity_multiplier) + '</dd></div>' +
      '<div class="kv"><dt>Implied token value</dt><dd class="big">' + moneyFull(r.implied_value_usd) + '</dd></div>' +
      '</dl>' +
      '<p class="derive">How this value was derived: <strong>' + moneyFull(r.implied_value_usd) + '</strong> = ' +
      moneyFull(r.tvl_usd) + ' TVL &times; ' + mult(r.base_multiple) + ' peer multiple &times; ' +
      r.growth_multiplier.toFixed(3) + ' growth &times; ' + r.maturity_multiplier.toFixed(3) + ' age. ' +
      'The multiple is ' + peerNote + '.</p></div>' +
      '<div class="card"><h3>Farm plan — five steps</h3><ol class="plan">' + steps + '</ol></div>' +
      '</div>' +
      '<div class="card"><h3>Protocol record</h3><dl>' +
      '<div class="kv"><dt>Chains</dt><dd>' + esc(r.chains.length ? r.chains.join(', ') : '—') + '</dd></div>' +
      '<div class="kv"><dt>Category</dt><dd>' + esc(r.category || '—') + '</dd></div>' +
      '<div class="kv"><dt>Tracked since</dt><dd>' + esc(r.listed_at || 'not recorded') + '</dd></div>' +
      '<div class="kv"><dt>Token status</dt><dd>records no token yet</dd></div>' +
      '</dl></div>';
  }

  function renderLive() {
    $('multiples-body').innerHTML = R.category_multiples.map(function (cm) {
      return '<tr><td>' + esc(cm.category) + '</td><td class="num">' + cm.peers + '</td>' +
        '<td class="num">' + (cm.median == null ? '—' : mult(cm.median)) + '</td>' +
        '<td class="num">' + mult(cm.multiple) + '</td></tr>';
    }).join('') +
      '<tr><td><span class="pname">All categories (global)</span></td><td class="num">' + R.global_peers + '</td>' +
      '<td class="num">' + mult(R.global_multiple) + '</td><td class="num">' + mult(R.global_multiple) + '</td></tr>';
    $('live-body').innerHTML = R.live.map(function (p) {
      var ratio = p.mcap_usd != null && p.tvl_usd > 0 ? (p.mcap_usd / p.tvl_usd).toFixed(2) + '×' : '—';
      var chg = p.change_7d == null ? '—' : '<span class="' + (p.change_7d >= 0 ? 'up' : 'down') + '">' + pct(p.change_7d) + '</span>';
      return '<tr><td><span class="pname">' + esc(p.name) + '</span><br><span class="slug">' + esc(p.slug) + '</span></td>' +
        '<td>' + esc(p.category || '—') + '</td>' +
        '<td class="chains">' + esc(chainText(p.chains)) + '</td>' +
        '<td class="num">' + money(p.tvl_usd) + '</td>' +
        '<td class="num">' + money(p.mcap_usd) + '</td>' +
        '<td class="num">' + ratio + '</td>' +
        '<td class="num">' + chg + '</td></tr>';
    }).join('');
  }

  function show(view, slug) {
    state.detail = slug || null;
    viewDetail.hidden = !slug;
    viewBoard.hidden = !!slug || view !== 'board';
    viewLive.hidden = !!slug || view !== 'live';
    tabBoard.classList.toggle('is-active', !slug && view === 'board');
    tabLive.classList.toggle('is-active', !slug && view === 'live');
    if (slug) window.scrollTo(0, 0);
  }

  function route() {
    var slug = location.hash ? location.hash.slice(1) : '';
    if (slug && bySlug[slug]) {
      renderDetail(bySlug[slug]);
      show(state.view, slug);
    } else {
      show(state.view, null);
    }
  }

  function wire() {
    $('f-q').addEventListener('input', function (e) { state.q = e.target.value; renderBoard(); });
    $('f-category').addEventListener('change', function (e) { state.category = e.target.value; renderBoard(); });
    $('f-chain').addEventListener('change', function (e) { state.chain = e.target.value; renderBoard(); });
    $('f-min').addEventListener('change', function (e) { state.min = Number(e.target.value); renderBoard(); });
    $('f-watch').addEventListener('change', function (e) { state.watch = e.target.checked; renderBoard(); });
    $('controls').addEventListener('submit', function (e) { e.preventDefault(); });
    document.querySelectorAll('#board-table th.sortable').forEach(function (th) {
      th.addEventListener('click', function () {
        var key = th.getAttribute('data-sort');
        if (state.sort === key) {
          state.dir = state.dir === 'desc' ? 'asc' : 'desc';
        } else {
          state.sort = key;
          state.dir = key === 'rank' || key === 'name' ? 'asc' : 'desc';
        }
        renderBoard();
      });
    });
    boardBody.addEventListener('click', function (e) {
      var tr = e.target.closest('tr[data-slug]');
      if (tr) location.hash = tr.getAttribute('data-slug');
    });
    $('back').addEventListener('click', function () { location.hash = ''; });
    tabBoard.addEventListener('click', function () { state.view = 'board'; location.hash = ''; show('board', null); });
    tabLive.addEventListener('click', function () { state.view = 'live'; location.hash = ''; show('live', null); });
    window.addEventListener('hashchange', route);
  }

  if (!R || !R.rows) {
    boardBody.innerHTML = '<tr><td class="empty" colspan="7">The radar data did not load. Run main.ts first; it writes data.js beside this page.</td></tr>';
    return;
  }
  fillHeader();
  buildFilterOptions();
  renderBoard();
  renderLive();
  wire();
  route();
  window.__radarReady = true;
})();
