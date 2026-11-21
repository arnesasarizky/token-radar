// Token Launch Radar — the model, re-run in your browser: the plain-JS
// twin of the Node model. impliedValue() · launchOdds() · farmPlan() ·
// planSize() · checkBoard() — same sealed snapshot in, same prices out.
window.RadarModel = (function () {
  "use strict";
  var R = window.RADAR || { meta: {}, rows: [], protocols: [], watchlist: [] };
  var P = R.protocols, ROWS = R.rows, WL = R.watchlist, DAY = 864e5;
  var bySlug = {}, rowBySlug = {};
  P.forEach(function (p) { bySlug[p.slug] = p; });
  ROWS.forEach(function (r) { rowBySlug[r.slug] = r; });

  // ---- snapshot clock: the as-of date is derived from the data, never typed in ----
  var asOf = (function () {
    if (R.meta && R.meta.asOf) return Date.parse(R.meta.asOf);
    if (R.meta && R.meta.as_of) return Date.parse(R.meta.as_of);
    var best = 0;
    ROWS.forEach(function (r) {
      var p = bySlug[r.slug];
      if (p && p.listed_at && r.ageDays != null) {
        var t = Date.parse(p.listed_at) + r.ageDays * DAY;
        if (t > best) best = t;
      }
    });
    return best || Date.parse("2026-11-14T00:00:00Z");
  })();
  function ageDays(p) {
    if (!p.listed_at) return null;
    var b = Date.parse(p.listed_at);
    if (!isFinite(b)) return null;
    return Math.max(0, Math.floor((asOf - b) / DAY));
  }
  function tokened(p) { return !!(p.gecko_id || p.symbol); }

  // ---- kin / sibling: a candidate whose name stem matches a tokened protocol,
  //      or that carries a traded symbol as a whole word, is priced at x0.5 ----
  var STEM_RE = /\s[Vv]\d+(\.\d+)?$|\s\d+\.\d+$/;
  function stemOf(name) { return String(name || "").toLowerCase().replace(STEM_RE, "").trim(); }
  var tokStems = {}, tokSym = {};
  P.forEach(function (p) {
    if (!p.symbol) return;
    tokStems[stemOf(p.name)] = 1;
    tokSym[p.symbol.toUpperCase()] = 1;
  });
  function isSibling(p) {
    if (tokened(p)) return false;
    if (tokStems[stemOf(p.name)]) return true;
    var toks = String(p.name || "").split(/[^A-Za-z0-9]+/);
    for (var i = 0; i < toks.length; i++) if (toks[i] && tokSym[toks[i].toUpperCase()]) return true;
    return false;
  }

  // ---- set-aside classes, for the 758 accounting ----
  var EXC_CAT = { "Bridge": "bridge", "Canonical Bridge": "bridge", "Liquid Staking": "lst",
    "Liquid Restaking": "lst", "Restaked BTC": "lst", "CEX": "cex" };
  function setAsideClass(p) {
    if (EXC_CAT[p.category]) return EXC_CAT[p.category];
    var n = String(p.name || "").trim();
    if (/\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/.test(n)) return "versioned";
    if (/\b(wrapped|staked|staking)\b/i.test(n)) return "wrapped";
    if (/^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i.test(n)) return "cex";
    return null;
  }

  // ---- small stats helpers ----
  function median(a) {
    var s = a.slice().sort(function (x, y) { return x - y; }), m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  function quantile(a, q) {
    var s = a.slice().sort(function (x, y) { return x - y; });
    if (!s.length) return 0;
    var i = q * (s.length - 1), lo = Math.floor(i);
    return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (i - lo);
  }

  // ---- comps pool: tokened, cap > 0, dated, not CEX, ratio in [0.005, 20],
  //      deduped per symbol keeping the largest cap ----
  var comps = null, compPts = null, fit = null, looRes = null;
  function buildComps() {
    var best = {};
    P.forEach(function (p) {
      if (!tokened(p) || !(p.mcap_usd > 0) || !p.listed_at || p.category === "CEX") return;
      var ratio = p.mcap_usd / p.tvl_usd;
      if (!(ratio >= 0.005 && ratio <= 20)) return;
      var key = (p.symbol || p.slug).toLowerCase();
      if (!best[key] || p.mcap_usd > best[key].mcap_usd) best[key] = p;
    });
    comps = Object.keys(best).map(function (k) { return best[k]; });
    compPts = comps.map(function (p) { return [Math.log10(p.tvl_usd), Math.log10(p.mcap_usd)]; });
  }
  function wls(pts, w) {
    var sw = 0, sx = 0, sy = 0, i;
    for (i = 0; i < pts.length; i++) { sw += w[i]; sx += w[i] * pts[i][0]; sy += w[i] * pts[i][1]; }
    var mx = sx / sw, my = sy / sw, sxy = 0, sxx = 0;
    for (i = 0; i < pts.length; i++) {
      var dx = pts[i][0] - mx;
      sxx += w[i] * dx * dx; sxy += w[i] * dx * (pts[i][1] - my);
    }
    var b = sxx > 0 ? sxy / sxx : 0;
    return [my - b * mx, b];
  }
  // Huber IRLS, delta 1.345, 8 rounds, MAD scale — the curve is the only pricing engine
  function fitCurve(pts) {
    var w = pts.map(function () { return 1; }), ab = wls(pts, w), k, i;
    for (k = 0; k < 8; k++) {
      var res = pts.map(function (p) { return p[1] - (ab[0] + ab[1] * p[0]); });
      var med = median(res);
      var mad = median(res.map(function (v) { return Math.abs(v - med); })) || 1e-9;
      var d = 1.345 * 1.4826 * mad;
      w = res.map(function (v) { var av = Math.abs(v); return av <= d ? 1 : d / av; });
      ab = wls(pts, w);
    }
    return ab;
  }
  function ensureFit() {
    if (fit) return;
    buildComps();
    fit = fitCurve(compPts);
  }
  // leave-one-out residuals of the comps, the raw material of every band
  function ensureLoo() {
    ensureFit();
    if (looRes) return;
    looRes = compPts.map(function (pt, i) {
      var sub = compPts.filter(function (_, j) { return j !== i; });
      var ab = fitCurve(sub);
      return pt[1] - (ab[0] + ab[1] * pt[0]);
    });
  }

  // ---- impliedValue(): value if launched = 10^(a + b * log10 TVL), x kin ----
  function impliedValue(p) {
    ensureFit();
    var curve = Math.pow(10, fit[0] + fit[1] * Math.log10(p.tvl_usd));
    var kin = isSibling(p) ? 0.5 : 1;
    var raw = curve * kin;
    return { value: Math.round(raw), raw: raw, mult: raw / p.tvl_usd, kin: kin, curve: curve };
  }
  // P25-P75 / P10-P90 band from LOO residuals of comps within +-0.5 dex of TVL
  function bandsFor(p, value) {
    ensureLoo();
    var x = Math.log10(p.tvl_usd), res = [];
    comps.forEach(function (c, i) {
      if (Math.abs(Math.log10(c.tvl_usd) - x) <= 0.5) res.push(looRes[i]);
    });
    if (res.length < 8) res = looRes;
    function f(q) { return Math.round(value * Math.pow(10, quantile(res, q))); }
    return { lo: f(0.25), hi: f(0.75), b10: f(0.10), b90: f(0.90) };
  }

  // ---- launchOdds(): empirical cells, age bucket x TVL band over all 758 ----
  function ageBucket(p) {
    var a = ageDays(p);
    if (a === null) return 6;
    return a < 180 ? 0 : a < 365 ? 1 : a < 730 ? 2 : a < 1095 ? 3 : a < 1825 ? 4 : 5;
  }
  function tvlBand(p) {
    var t = p.tvl_usd;
    return t < 1e7 ? 0 : t < 5e7 ? 1 : t < 2e8 ? 2 : t < 1e9 ? 3 : 4;
  }
  var oddsFit = null;
  function buildOdds() {
    var cell = [], ageM = [], bandM = [], i, j, n = 0, k = 0;
    for (i = 0; i < 7; i++) { ageM.push({ n: 0, k: 0 }); cell.push([]); for (j = 0; j < 5; j++) cell[i].push({ n: 0, k: 0 }); }
    for (j = 0; j < 5; j++) bandM.push({ n: 0, k: 0 });
    P.forEach(function (p) {
      var a = ageBucket(p), b = tvlBand(p), t = tokened(p) ? 1 : 0;
      cell[a][b].n++; cell[a][b].k += t;
      ageM[a].n++; ageM[a].k += t;
      bandM[b].n++; bandM[b].k += t;
      n++; k += t;
    });
    oddsFit = { cell: cell, ageM: ageM, bandM: bandM, base: n ? k / n : 0.549 };
  }
  function laplace(c) { return (c.k + 1) / (c.n + 2); }
  function launchOdds(p) {
    if (!oddsFit) buildOdds();
    var c = oddsFit.cell[ageBucket(p)][tvlBand(p)];
    if (c.n >= 20) return laplace(c);
    var a = oddsFit.ageM[ageBucket(p)];
    if (a.n >= 20) return laplace(a);
    var b = oddsFit.bandM[tvlBand(p)];
    if (b.n >= 20) return laplace(b);
    return oddsFit.base;
  }

  // ---- farmPlan(): the farm economics of one row at any ticket ----
  var FEE_PRIORS = { "Ethereum": 6.00, "Arbitrum": 0.45, "Base": 0.35, "BSC": 0.30, "Solana": 0.10, "_default": 1.50 };
  function feePrior(chain) { return FEE_PRIORS[chain] != null ? FEE_PRIORS[chain] : FEE_PRIORS._default; }
  // Weeks held is backed out of the board's own plan-size costs.
  function weeksOf(row, fees) {
    var w = (row.costs - fees) * 52 / ((row.plan || 1000) * 0.04);
    if (isFinite(w) && w >= 1 && w <= 60) return w;
    var ds = (row.steps || []).map(function (s) { return Date.parse(s.date); }).filter(isFinite);
    if (ds.length > 1) return Math.min(52, Math.max(1, Math.round((Math.max.apply(null, ds) - Math.min.apply(null, ds)) / (7 * DAY))));
    return 10;
  }
  function verdictOf(be) { return be <= 0.10 ? "FARM" : be <= 0.33 ? "THIN" : "SKIP"; }
  // planSize(): the board's default deposit for a row — 0.02% of its TVL,
  // clamped to [$500, $10,000]; the twin of planSizeFor() in the Node model.
  function planSize(tvl) { return Math.min(10000, Math.max(500, 0.0002 * tvl)); }
  function farmPlan(row, ticket, share, tbill) {
    var fees = 0, mins = 0;
    (row.steps || []).forEach(function (s) { fees += s.fee || 0; mins += s.minutes || 0; });
    if (!row.steps || !row.steps.length) { fees = feePrior((row.chains || [])[0]) * 6; mins = 300; }
    var weeks = weeksOf(row, fees);
    function at(t, sh, tb) {
      var slice = sh * row.valueIfLaunched * t / (row.tvl + t);
      var costs = fees + t * tb * weeks / 52;
      var net = slice - costs;
      var be = slice > 0 ? costs / slice : Infinity;
      return { slice: slice, costs: costs, net: net, be: be, verdict: verdictOf(be) };
    }
    var cur = at(ticket, share, tbill);
    var sliceLow = share * row.bandLo * ticket / (row.tvl + ticket);
    // pays-from: the smallest ticket whose net turns non-negative at these
    // assumptions; null when no ticket pays (break-even odds above 100%)
    var pays = null;
    if (cur.be <= 1) {
      var netAt = function (t) { return at(t, share, tbill).net; };
      if (netAt(1) >= 0) pays = 1;
      else {
        var lo = 1, hi = 2, guard = 0;
        while (netAt(hi) < 0 && hi < 2e7 && guard++ < 40) { lo = hi; hi *= 4; }
        if (netAt(hi) >= 0) {
          for (var i = 0; i < 42; i++) { var mid = (lo + hi) / 2; if (netAt(mid) >= 0) hi = mid; else lo = mid; }
          pays = hi;
        }
      }
    }
    var robust = true;
    [0.05, 0.10, 0.20].forEach(function (sh) {
      [0, 0.04, 0.08].forEach(function (tb) { if (at(ticket, sh, tb).verdict !== "FARM") robust = false; });
    });
    return { fees: fees, minutes: mins, hours: mins / 60, weeks: weeks, slice: cur.slice,
      costs: cur.costs, net: cur.net, netLow: sliceLow - cur.costs,
      perHour: mins > 0 ? cur.net / (mins / 60) : 0, be: cur.be, verdict: cur.verdict,
      paysFrom: pays, robust: robust, at: at };
  }

  // The Method view's validation extras (odds reliability deciles, band
  // cohorts, weakest category) ship in the board's meta, computed once by
  // the Node model; the browser's re-pricing core is checkBoard() below.

  // ---- checkBoard(): re-price the whole board in the browser and compare.
  //      The integrity strip: board total and an FNV-1a seal over
  //      rank:slug:implied, from the shipped rows and from the re-pricing —
  //      equal only if every implied value here is the model's own. ----
  function sealOf(parts) {
    var h = 0x811c9dc5, s = parts.join(";");
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return ("0000000" + h.toString(16)).slice(-8);
  }
  function checkBoard() {
    ensureFit();
    var match = 0, totMine = 0, totShip = 0, mine = [], ship = [];
    ROWS.forEach(function (row) {
      var p = bySlug[row.slug];
      if (!p) return;
      var v = impliedValue(p);
      var o = launchOdds(p);
      var band = bandsFor(p, v.value);
      var fp = farmPlan(row, planSize(row.tvl), 0.10, 0.04);
      var imp = Math.max(1, Math.round(v.raw * o)), impShip = Math.max(1, row.ev);
      totMine += imp; totShip += impShip;
      mine.push(row.rank + ":" + row.slug + ":" + imp);
      ship.push(row.rank + ":" + row.slug + ":" + impShip);
      var ok = Math.abs(v.value - row.valueIfLaunched) <= 1 &&
        Math.round(o * 1000) === Math.round(row.odds * 1000) &&
        Math.abs(band.lo - row.bandLo) <= Math.max(1, row.bandLo * 0.005) &&
        Math.abs(band.hi - row.bandHi) <= Math.max(1, row.bandHi * 0.005) &&
        fp.verdict === row.verdict;
      if (ok) match++;
    });
    var wlIn = WL.filter(function (s) { return rowBySlug[s]; }).length;
    var accounted = 0;
    P.forEach(function (p) {
      if (tokened(p) || rowBySlug[p.slug] || setAsideClass(p)) accounted++;
    });
    var sM = sealOf(mine), sS = sealOf(ship);
    var line = "page = board.json · " + match + "/" + ROWS.length +
      " rows re-priced in your browser match · board total $" + totShip.toLocaleString("en-US") +
      " = $" + totMine.toLocaleString("en-US") + " · seal " + sS + " = " + sM +
      " · watchlist " + wlIn + "/" + WL.length +
      " · " + accounted + "/" + P.length + " accounted";
    if (window.console && console.log) console.log(line);
    return { line: line, match: match, total: ROWS.length, watchlist: wlIn, accounted: accounted,
      totalShip: totShip, totalMine: totMine, sealShip: sS, sealMine: sM };
  }

  return {
    impliedValue: impliedValue, launchOdds: launchOdds, farmPlan: farmPlan, planSize: planSize, checkBoard: checkBoard,
    bandsFor: bandsFor, ageDays: ageDays, tokened: tokened, isSibling: isSibling,
    setAsideClass: setAsideClass,
    verdictOf: verdictOf, feePrior: feePrior, FEE_PRIORS: FEE_PRIORS,
    curve: function () { ensureFit(); return { a: fit[0], b: fit[1] }; },
    comps: function () { ensureFit(); return comps; },
    asOfISO: new Date(asOf).toISOString().slice(0, 10)
  };
})();
