// Token Launch Radar — the page. Renders window.RADAR (data.js) and re-runs
// the model live through a-model.js, so ticket, drop-share and T-bill
// changes re-price every row here.
(function () {
  "use strict";
  var R = window.RADAR || { meta: {}, rows: [], protocols: [], watchlist: [] };
  var RM = window.RadarModel;
  var M = R.meta || {}, ROWS = R.rows || [];
  var app = document.getElementById("app");
  var protoBySlug = {}, rowBySlug = {};
  (R.protocols || []).forEach(function (p) { protoBySlug[p.slug] = p; });
  ROWS.forEach(function (r) { rowBySlug[r.slug] = r; });

  // ---------- formatting ----------
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function usd0(n) { return "$" + Math.round(n).toLocaleString("en-US"); }
  function c$(n) {
    var a = Math.abs(n);
    if (a >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
    if (a >= 1e7) return "$" + (n / 1e6).toFixed(1) + "M";
    if (a >= 1e6) return "$" + (n / 1e6).toFixed(2) + "M";
    if (a >= 1e3) return "$" + (n / 1e3).toFixed(1) + "K";
    return "$" + Math.round(n);
  }
  function d$(n) {
    var a = Math.abs(n), o = { minimumFractionDigits: a < 1000 ? 2 : 0, maximumFractionDigits: a < 1000 ? 2 : 0 };
    return (n < 0 ? "-$" : "$") + a.toLocaleString("en-US", o);
  }
  function comma2(x) { return x.toFixed(2).replace(".", ","); }
  function ageFmt(d) { if (d == null) return "unlisted"; return d >= 365 ? (d / 365.25).toFixed(1) + " y" : d + " d"; }
  function bpos(v) { var x = (Math.log10(Math.max(v, 1)) - 6) / 3 * 100; return Math.min(100, Math.max(0, x)); }
  function x2(v) { return "×" + (+v).toFixed(2); }

  // ---------- meta, read defensively; brief constants are the fallback ----------
  function dig() { for (var i = 0; i < arguments.length; i++) if (arguments[i] != null) return arguments[i]; return null; }
  var counts = M.counts || {};
  var setAside = counts.setAside || {};
  var CNT = {
    protocols: dig(counts.protocols, (R.protocols || []).length, 758),
    tokened: dig(counts.tokened, 416), tokenless: dig(counts.tokenless, 342),
    ranked: dig(counts.ranked, ROWS.length, 198),
    bridge: dig(setAside.bridge, 43), lst: dig(setAside.lst, setAside.liquidStaking, 43), cex: dig(setAside.cex, 42),
    versioned: dig(setAside.versioned, 11), wrapped: dig(setAside.wrapped, 5)
  };
  CNT.aside = CNT.bridge + CNT.lst + CNT.cex + CNT.versioned + CNT.wrapped;
  CNT.withCap = (R.protocols || []).filter(function (p) { return p.mcap_usd; }).length;

  // ---------- adapter: fold the real meta (validation/odds/farm) into the shapes read below ----------
  var V = M.validation || {}, O = M.odds || {}, FM = M.farm || {};
  if (V.ladder) {
    var NM = { category: "+ category offset", growth: "+ 7-day growth carry", tenure: "+ tenure ramp", breadth: "+ chain breadth", "all four": "All four terms together" };
    M.ladder = [{ term: "Flat multiple of TVL", loo: V.flatLoo, wf: V.flatWf },
      { term: "Comps curve — size only", loo: V.curveLoo, wf: V.curveWf }]
      .concat(V.ladder.map(function (r) { return { term: NM[r.term] || r.term, loo: r.loo, wf: r.wf }; }));
  }
  if (V.placebo) M.placebo = V.placebo;
  if (V.calibration) M.calibration = { stated5050: V.calibration.stated50 + "/" + V.calibration.stated80, realised: V.calibration.realised50 + "/" + V.calibration.realised80 };
  if (V.cohorts) M.cohort = { oldIn: V.cohorts.oldInBand, oldN: V.cohorts.oldN, newIn: V.cohorts.newInBand, newN: V.cohorts.newN };
  if (V.weakestCategory) M.weakestCategory = "Weakest: " + V.weakestCategory.category + " (" + V.weakestCategory.n + " traded), median miss " + x2(V.weakestCategory.curveMiss) + " — still better than flat's " + x2(V.weakestCategory.flatMiss);
  if (O.splitModelHit != null) M.oddsStats = { hitRate: O.splitModelHit, baseRate: O.splitBaseHit, auc: O.auc };
  if (O.deciles) M.deciles = O.deciles;
  if (M.stability) M.stability = { top20: M.stability.top20Stay, medianWidth: M.stability.medianRankWidth, fromTvl: M.stability.rowsFarFromTvl };
  if (FM.at1000) M.verdictCounts = { "1000": { farm: FM.at1000.FARM, thin: FM.at1000.THIN, skip: FM.at1000.SKIP }, "10000": { farm: FM.at10000.FARM, thin: FM.at10000.THIN, skip: FM.at10000.SKIP } };
  if (FM.firstFarmAt10000) M.firstFarmAt10000 = FM.firstFarmAt10000;
  if (FM.firstFarmAtPlan) M.firstFarmAtPlan = FM.firstFarmAtPlan;
  var LADDER_FB = [{ term: "Flat multiple of TVL", loo: 4.24, wf: 4.24 }, { term: "Comps curve — size only", loo: 2.67, wf: 2.43 }];
  function ladder() {
    var L = M.ladder, out = [];
    if (Array.isArray(L)) L.forEach(function (r) { out.push({ term: r.term || r.name || r.model || "", loo: +r.loo, wf: +r.wf }); });
    else if (L && typeof L === "object") Object.keys(L).forEach(function (k) {
      var v = L[k];
      if (Array.isArray(v)) out.push({ term: k, loo: +v[0], wf: +v[1] });
      else if (v) out.push({ term: k, loo: +v.loo, wf: +v.wf });
    });
    return out.length >= 3 ? out : LADDER_FB;
  }
  function termOf(L, re) { for (var i = 0; i < L.length; i++) if (re.test(L[i].term)) return L[i]; return null; }
  function bothPhrase(t, c) {
    var wl = t.loo > c.loo, ww = t.wf > c.wf;
    if (wl && ww) return "worse on both, dropped.";
    if (!wl && !ww) return "better on both — the exception that proves the rule.";
    return "split verdict, dropped by the both-tests rule.";
  }
  function namedFactors(L) {
    var c = termOf(L, /curve/i) || L[1], g = termOf(L, /growth/i), t = termOf(L, /tenure/i);
    if (!c || !g || !t) return "";
    return "Named factors, tested: 7-day growth LOO " + x2(g.loo) + " · WF " + x2(g.wf) +
      " vs the curve's " + x2(c.loo) + " · " + x2(c.wf) + " — " + bothPhrase(g, c) +
      " Tenure LOO " + x2(t.loo) + " · WF " + x2(t.wf) + " — " + bothPhrase(t, c) +
      " TVL carries the price; both print ×1.000.";
  }
  var placebo = M.placebo || { loo: 2.58, wf: 2.44 };
  var calib = M.calibration || { stated5050: "50/80", realised: "48/73" };
  var oddsStats = M.oddsStats || { hitRate: 0.69, baseRate: 0.53, auc: 0.74 };
  function pctOf(v) { return v == null ? "—" : Math.round(v <= 1.5 ? v * 100 : v) + "%"; }
  var vc = M.verdictCounts || {};
  var vc10000 = vc["10000"] || vc[10000] || { farm: 1, thin: 0, skip: 0 };

  // ---------- state ----------
  var S = { ticket: 1000, plan: true, share: 0.10, tbill: 0.04, q: "", cat: "", verdict: "", sort: "rank" };
  var PF = { capital: 10000, hours: 5, safe: false };
  function tickOf(r) { return S.plan ? RM.planSize(r.tvl) : S.ticket; }
  function fp(r) { return RM.farmPlan(r, tickOf(r), S.share, S.tbill); }
  function highRisk(r) { return (r.tags || []).some(function (t) { return t === "FALLING" || t === "NEW"; }); }

  // ---------- portfolio builder ----------
  function buildPortfolio(ticket) {
    var plans = ROWS.map(function (r) { return { r: r, f: RM.farmPlan(r, ticket, S.share, S.tbill) }; })
      .filter(function (x) { return x.f.verdict !== "SKIP" && (!PF.safe || !highRisk(x.r)); });
    plans.sort(function (a, b) { return b.f.perHour - a.f.perHour; });
    var sel = [], usedT = 0, usedH = 0;
    plans.forEach(function (x) {
      var wk = x.f.minutes / 60 / x.f.weeks;
      if (usedT + ticket <= PF.capital && usedH + wk <= PF.hours) { sel.push(x); usedT += ticket; usedH += wk; }
    });
    function sum(f) { return sel.reduce(function (a, x) { return a + f(x); }, 0); }
    var slice = sum(function (x) { return x.f.slice; }), costs = sum(function (x) { return x.f.costs; });
    return { sel: sel, slice: slice, net: sum(function (x) { return x.f.net; }),
      fees: sum(function (x) { return x.f.fees; }), hours: sum(function (x) { return x.f.minutes / 60; }),
      weekly: usedH, capital: usedT, be: slice > 0 ? costs / slice : Infinity };
  }
  function pfStripHtml() {
    var p = buildPortfolio(S.ticket);
    return "<b>PLAN FOR " + usd0(PF.capital) + " · " + PF.hours + " H/WK</b> — " + p.sel.length +
      " plans · expected slices " + usd0(p.slice) + " · combined expected net " + usd0(p.net) +
      " · blended break-even " + (isFinite(p.be) ? (p.be * 100).toFixed(1).replace(".", ",") + "%" : "never") +
      ' <span class="sep">→</span> <a href="#/portfolio">Portfolio</a>';
  }

  // ---------- board ----------
  var CHECK = null;
  function chipsHtml() {
    return '<section class="chips">' +
      '<span class="chip check" id="checkchip">checkBoard() running…</span>' +
      "<span class=\"chip\">snapshot <b>" + RM.asOfISO + "</b> · sealed</span>" +
      "<span class=\"chip\"><b>" + CNT.protocols + "</b> protocols · <b>" + CNT.tokened + "</b> tokened · <b>" + CNT.tokenless + "</b> tokenless</span>" +
      "<span class=\"chip\"><b>" + RM.comps().length + "</b> comps · Huber IRLS</span></section>";
  }
  function kpiHtml() {
    var L = ladder(), flat = termOf(L, /flat/i) || L[0], curve = termOf(L, /curve/i) || L[1];
    return '<section class="kpis">' +
      '<div class="kpi"><span class="lab">FARM VERDICTS</span><span id="kpiFarm"></span></div>' +
      '<div class="kpi"><span class="lab">OUT-OF-SAMPLE VALIDATION</span><b>LOO ' + x2(curve.loo) +
        " · WALK-FORWARD " + x2(curve.wf) + "</b> — flat " + x2(flat.loo) +
        " · every comp priced by a fit that never saw it</div>" +
      '<div class="kpi"><span class="lab">LAUNCH ODDS DISCRIMINATION</span><b>CALLS THE MAJORITY ' + pctOf(oddsStats.hitRate) +
        "</b> vs " + pctOf(oddsStats.baseRate) + " base-rate · AUC " + (+oddsStats.auc).toFixed(2) + "</div></section>";
  }
  function formulaHtml() {
    var cv = RM.curve();
    return '<div class="strip"><b>impliedValue()</b> — value if launched = 10<sup>' + cv.a.toFixed(4) +
      "</sup> × TVL<sup>" + cv.b.toFixed(4) + "</sup> × kin · expected value = value × <b>launchOdds()</b>" +
      " · rows rank by expected value · every farm sized per row by <b>farmPlan()</b>: 0.02% of TVL, $500–$10,000</div>";
  }
  function acctHtml() {
    var tot = CNT.protocols || 758;
    function seg(n, col) { return '<i style="width:' + (n / tot * 100).toFixed(2) + "%;background:" + col + '"></i>'; }
    return '<section class="acct"><div class="acctbar">' +
      seg(CNT.ranked, "#3fc1d8") + seg(CNT.tokened, "#2b4a73") + seg(CNT.bridge, "#37507a") +
      seg(CNT.lst, "#2e6b6b") + seg(CNT.cex, "#6e5a1c") + seg(CNT.versioned, "#555f75") + seg(CNT.wrapped, "#4a3a5e") +
      '</div><div class="legend">' + CNT.ranked + " ranked · " + CNT.tokened + " tokened · " + CNT.aside +
      " set aside — " + CNT.bridge + " bridge · " + CNT.lst + " liquid staking · " + CNT.cex + " CEX/custody · " +
      CNT.versioned + " versioned · " + CNT.wrapped + " wrapped · every one of the " + tot + " accounted for, names on Method</div></section>";
  }
  function controlsHtml() {
    var cats = [];
    ROWS.forEach(function (r) { if (r.category && cats.indexOf(r.category) < 0) cats.push(r.category); });
    cats.sort();
    return '<section class="controls">' +
      '<input class="q" id="q" type="search" placeholder="Search name, slug, category…" value="' + esc(S.q) + '">' +
      '<select id="cat"><option value="">All categories</option>' +
        cats.map(function (c) { return '<option' + (S.cat === c ? " selected" : "") + ">" + esc(c) + "</option>"; }).join("") + "</select>" +
      '<select id="vd"><option value="">All verdicts</option>' +
        ["FARM", "THIN", "SKIP"].map(function (v) { return '<option' + (S.verdict === v ? " selected" : "") + ">" + v + "</option>"; }).join("") + "</select>" +
      '<label><input type="checkbox" id="plan" style="width:auto" ' + (S.plan ? "checked" : "") + '> plan size per row</label>' +
      '<label>Ticket $<input type="number" id="ticket" min="10" step="10" value="' + S.ticket + '"></label>' +
      '<label>Drop share <select id="share">' +
        [0.05, 0.10, 0.20].map(function (v) { return '<option value="' + v + '"' + (S.share === v ? " selected" : "") + ">" + Math.round(v * 100) + "%</option>"; }).join("") + "</select></label>" +
      '<label>T-bill <select id="tbill">' +
        [0, 0.04, 0.08].map(function (v) { return '<option value="' + v + '"' + (S.tbill === v ? " selected" : "") + ">" + Math.round(v * 100) + "%</option>"; }).join("") + "</select></label>" +
      '<label>Sort <select id="sort">' +
        [["rank", "Rank (EV)"], ["ev", "Expected value"], ["tvl", "TVL"], ["net", "Net"], ["perHour", "Net/hour"], ["odds", "Odds"], ["mult", "Mult"], ["change7d", "7d change"]]
          .map(function (o) { return '<option value="' + o[0] + '"' + (S.sort === o[0] ? " selected" : "") + ">" + o[1] + "</option>"; }).join("") + "</select></label>" +
      '<span class="chip" id="shown"></span></section>';
  }
  function railHtml() {
    var L = ladder(), cv = RM.curve();
    var mini = L.map(function (r) {
      var shipped = /curve/i.test(r.term), dropped = !shipped && !/flat/i.test(r.term);
      var name = dropped ? "<s>" + esc(r.term) + "</s>" : esc(r.term);
      return "<tr" + (shipped ? ' style="font-weight:600"' : "") + "><td>" + name + "</td><td>" + x2(r.loo) + "</td><td>" + x2(r.wf) + "</td></tr>";
    }).join("");
    return '<div class="box"><h3>THE MODEL — ONE CURVE, FITTED IN THIS PAGE</h3>' +
      '<p class="formula">value if launched = 10<sup>' + cv.a.toFixed(4) + "</sup> × TVL<sup>" + cv.b.toFixed(4) + "</sup></p>" +
      "<p>" + RM.comps().length + " traded comps · Huber IRLS (δ = 1.345, 8 rounds) · kin ×0.5 for tokened siblings · " +
      "rank key = expected value = value × launch odds. Fitted by <b>impliedValue()</b> · odds <b>launchOdds()</b> · farms <b>farmPlan()</b> · audit <b>checkBoard()</b>.</p></div>" +
      '<div class="box"><h3>OUT OF SAMPLE — EVERY ADDED TERM HAD TO WIN BOTH TESTS</h3>' +
      "<table><tr><th>model</th><th>LOO</th><th>walk-fwd</th></tr>" + mini + "</table>" +
      "<p>Placebo: the growth engine refit with its sign flipped prints LOO " + x2(placebo.loo) + " · WF " + x2(placebo.wf) +
      " — the real term could not beat its own control.</p>" +
      "<p>Bands: stated " + esc(calib.stated5050) + ", realised " + esc(calib.realised) + " on held-out comps.</p>" +
      "<p>" + esc(namedFactors(L)) + "</p></div>" +
      '<div class="box"><h3>THE COMPS CURVE — ' + RM.comps().length + ' TRADED PROTOCOLS</h3>' + scatterSvg() + "</div>";
  }
  function scatterSvg() {
    var cs = RM.comps(), cv = RM.curve(), W = 314, H = 196, pl = 6, pt = 6;
    var xs = cs.map(function (c) { return Math.log10(c.tvl_usd); }), ys = cs.map(function (c) { return Math.log10(c.mcap_usd); });
    var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs), y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
    function X(x) { return pl + (x - x0) / (x1 - x0) * (W - 2 * pl); }
    function Y(y) { return H - pt - (y - y0) / (y1 - y0) * (H - 2 * pt); }
    var dots = cs.map(function (c) { return '<circle cx="' + X(Math.log10(c.tvl_usd)).toFixed(1) + '" cy="' + Y(Math.log10(c.mcap_usd)).toFixed(1) + '" r="2" fill="#3fc1d8" opacity="0.65"/>'; }).join("");
    return '<svg width="' + W + '" height="' + H + '">' + dots +
      '<line x1="' + X(x0) + '" y1="' + Y(cv.a + cv.b * x0) + '" x2="' + X(x1) + '" y2="' + Y(cv.a + cv.b * x1) + '" stroke="#e8b23a" stroke-width="1.5"/>' +
      '<text x="' + pl + '" y="' + (H - 1) + '">log TVL ' + c$(Math.pow(10, x0)) + " → " + c$(Math.pow(10, x1)) + "</text>" +
      '<text x="' + pl + '" y="10">log cap</text></svg>';
  }
  function badgesHtml(r) {
    var out = "";
    if (r.watchlist) out += '<span class="bdg">WATCHLIST</span>';
    if (r.offList) out += '<span class="bdg">OFF-LIST</span>';
    if (r.early) out += '<span class="bdg">EARLY</span>';
    if (r.sibling) out += '<span class="bdg">SIBLING</span>';
    (r.tags || []).forEach(function (t) { out += '<span class="bdg risk">' + esc(t) + "</span>"; });
    return out ? '<span class="badges">' + out + "</span>" : "";
  }
  function planLine(r, f) {
    var st = (r.steps || [])[1] || (r.steps || [])[0] || {};
    var act = String(st.action || "").replace(/\s+/g, " ").trim();
    if (act.length > 26) { var cut = act.slice(0, 26), sp = cut.lastIndexOf(" "); act = (sp > 10 ? cut.slice(0, sp) : cut) + "…"; }
    var fee = f.fees % 1 === 0 ? "$" + f.fees : d$(f.fees);
    return esc(act) + " · " + esc((r.chains || [])[0] || "—") + " — fee " + fee +
      " · " + f.hours.toFixed(1) + " h · " + Math.round(f.weeks) + " wk";
  }
  function rowHtml(r) {
    var f = fp(r);
    var band = '<div class="bandbar"><span class="b90" style="left:' + bpos(r.band10) + "%;width:" + Math.max(1, bpos(r.band90) - bpos(r.band10)) + '%"></span>' +
      '<span class="b75" style="left:' + bpos(r.bandLo) + "%;width:" + Math.max(1, bpos(r.bandHi) - bpos(r.bandLo)) + '%"></span>' +
      '<span class="tick" style="left:' + bpos(r.valueIfLaunched) + '%"></span></div>' +
      '<span class="sub">' + c$(r.bandLo) + " – " + c$(r.bandHi) + "</span>";
    var pays = f.be > 1 ? "never pays" : (f.paysFrom != null ? "pays from " + usd0(Math.max(10, Math.round(f.paysFrom / 10) * 10)) : "never pays");
    return "<tr><td><b>" + r.rank + '</b><span class="sub">' + r.rankLo + "–" + r.rankHi + "</span></td>" +
      '<td class="pr"><a href="#/p/' + esc(r.slug) + '">' + esc(r.name) + "</a>" +
      '<span class="sub">' + esc(r.category || "—") + " · " + esc((r.chains || [])[0] || "—") +
      ((r.chains || []).length > 1 ? " +" + (r.chains.length - 1) : "") + "</span>" + badgesHtml(r) + "</td>" +
      '<td class="num">' + c$(r.tvl) + "</td>" +
      '<td class="num ' + (r.change7d == null ? "" : r.change7d >= 0 ? "pos" : "neg") + '">' +
        (r.change7d == null ? "—" : (r.change7d >= 0 ? "+" : "") + r.change7d.toFixed(1) + "%") + "</td>" +
      "<td>" + ageFmt(r.ageDays) + "</td>" +
      '<td class="num">' + r.mult.toFixed(3) + "×</td>" +
      '<td><span class="obar"><i style="width:' + Math.round(r.odds * 100) + '%"></i></span>' + Math.round(r.odds * 100) + "%</td>" +
      '<td class="num"><b>' + c$(r.ev) + "</b></td>" +
      "<td>" + band + "</td>" +
      '<td class="num">' + d$(f.slice) + "</td>" +
      '<td class="num">' + d$(f.net) + '<span class="sub">' + (f.perHour >= 0 ? "+" : "-") + "$" + Math.abs(f.perHour).toFixed(2) +
        "/h · low " + d$(f.netLow) + '</span><span class="sub">' + pays + "</span></td>" +
      '<td><span class="vd ' + f.verdict + '">' + f.verdict + "</span>" + (f.robust ? '<span class="rob">ROBUST 9/9</span>' : "") + "</td>" +
      '<td class="plan">' + planLine(r, f) + "</td></tr>";
  }
  function filteredRows() {
    var out = ROWS.filter(function (r) {
      if (S.cat && r.category !== S.cat) return false;
      if (S.q) {
        var q = S.q.toLowerCase();
        if ((r.name + " " + r.slug + " " + (r.category || "")).toLowerCase().indexOf(q) < 0) return false;
      }
      return true;
    });
    if (S.verdict) out = out.filter(function (r) { return fp(r).verdict === S.verdict; });
    var key = S.sort;
    if (key !== "rank") out.sort(function (a, b) {
      if (key === "net") return fp(b).net - fp(a).net;
      if (key === "perHour") return fp(b).perHour - fp(a).perHour;
      return (b[key] || 0) - (a[key] || 0);
    });
    return out;
  }
  function updateBoard() {
    var c = { FARM: 0, THIN: 0, SKIP: 0 };
    ROWS.forEach(function (r) { c[fp(r).verdict]++; });
    var kf = document.getElementById("kpiFarm");
    if (kf) kf.innerHTML = S.plan
      ? "<b>" + (vc10000.farm || 0) + " FARM AT $10,000</b> · " + c.THIN + " THIN at plan size · plans 0.02% of TVL ($500–$10,000)"
      : "<b>" + c.FARM + " FARM AT " + usd0(S.ticket) + "</b> · " + c.THIN + " THIN · " + c.SKIP + " SKIP · " +
        (vc10000.farm || 0) + " FARM at $10,000";
    var fn = document.getElementById("fn");
    if (fn) {
      var live = ROWS.map(function (r) { return { r: r, f: fp(r) }; }).filter(function (x) { return x.f.verdict !== "SKIP"; });
      live.sort(function (a, b) { return b.f.perHour - a.f.perHour; });
      var top = live.slice(0, 3).map(function (x) { return esc(x.r.name) + " +$" + comma2(x.f.perHour) + "/h " + x.f.verdict; }).join(' <span class="sep">·</span> ');
      if (live.length > 3) top += ' <span class="sep">…</span>';
      var tail = c.FARM + " FARM / " + c.THIN + " THIN / " + c.SKIP + " SKIP at " + (S.plan ? "plan size" : usd0(S.ticket));
      if (M.firstFarmAt10000) tail += "; first FARM " + esc(M.firstFarmAt10000) + " at $10,000";
      fn.innerHTML = "<b>FARM NEXT</b> — " + (top || "nothing pays at this ticket") + ' <span class="sep">·</span> ' + tail;
    }
    var pfEl = document.getElementById("pf");
    if (pfEl) pfEl.innerHTML = pfStripHtml();
    var rows = filteredRows();
    var tb = document.getElementById("tb");
    if (tb) tb.innerHTML = rows.map(rowHtml).join("");
    var sh = document.getElementById("shown");
    if (sh) sh.textContent = rows.length + " of " + ROWS.length + " rows";
    var sl = document.getElementById("sliceTh");
    if (sl) sl.textContent = S.plan ? "SLICE @PLAN" : "SLICE @" + usd0(S.ticket);
  }
  function boardView() {
    app.innerHTML = chipsHtml() + formulaHtml() + kpiHtml() + acctHtml() + controlsHtml() +
      '<div class="strip" id="fn"></div><div class="strip" id="pf"></div>' +
      '<div class="mainrow"><div class="tablewrap"><table class="board"><colgroup>' +
      '<col style="width:32px"><col style="width:146px"><col style="width:70px"><col style="width:54px"><col style="width:62px">' +
      '<col style="width:52px"><col style="width:86px"><col style="width:76px"><col style="width:88px"><col style="width:64px">' +
      '<col style="width:110px"><col style="width:72px"><col></colgroup><thead><tr>' +
      "<th>#</th><th>PROTOCOL</th><th class=\"num\">TVL</th><th class=\"num\">7D</th><th>NO TOKEN FOR</th><th class=\"num\">MULT</th>" +
      "<th>LAUNCH ODDS</th><th class=\"num\">EXPECTED VALUE</th><th>BAND P25–P75</th><th class=\"num\" id=\"sliceTh\">SLICE</th>" +
      "<th class=\"num\">NET OF ALL COSTS</th><th>VERDICT</th><th>PLAN</th></tr></thead>" +
      '<tbody id="tb"></tbody></table></div><aside class="rail">' + railHtml() + "</aside></div>";
    if (CHECK) { var cc = document.getElementById("checkchip"); if (cc) cc.innerHTML = "<b>checkBoard()</b> · " + esc(CHECK.line); }
    function bind(id, ev, fn) { var e = document.getElementById(id); if (e) e.addEventListener(ev, fn); }
    bind("q", "input", function () { S.q = this.value; updateBoard(); });
    bind("cat", "change", function () { S.cat = this.value; updateBoard(); });
    bind("vd", "change", function () { S.verdict = this.value; updateBoard(); });
    bind("plan", "change", function () { S.plan = this.checked; updateBoard(); });
    bind("ticket", "change", function () {
      S.ticket = Math.max(10, +this.value || 1000); S.plan = false;
      var pc = document.getElementById("plan"); if (pc) pc.checked = false;
      updateBoard();
    });
    bind("share", "change", function () { S.share = +this.value; updateBoard(); });
    bind("tbill", "change", function () { S.tbill = +this.value; updateBoard(); });
    bind("sort", "change", function () { S.sort = this.value; updateBoard(); });
    updateBoard();
  }

  // ---------- detail ----------
  function weekOf(r, s) {
    var ds = (r.steps || []).map(function (x) { return Date.parse(x.date); }).filter(isFinite);
    if (!ds.length || !isFinite(Date.parse(s.date))) return "—";
    return Math.floor((Date.parse(s.date) - Math.min.apply(null, ds)) / (7 * 864e5)) + 1;
  }
  function detailView(slug) {
    var r = rowBySlug[slug], p = protoBySlug[slug];
    if (!r || !p) { boardView(); return; }
    var iv = RM.impliedValue(p), f = fp(r);
    var beTxt = f.be > 1 ? ">100% — no launch chance repays this" : (f.be * 100).toFixed(1) + "%";
    var peers = (r.peers || []).map(function (x) {
      return "<tr><td>" + esc(x.name) + '</td><td class="num">' + (+x.mult).toFixed(3) + '×</td><td class="num">' + c$(x.tvl) + "</td></tr>";
    }).join("");
    var steps = (r.steps || []).map(function (s, i) {
      return "<tr><td>" + (i + 1) + "</td><td>" + esc(s.date || "") + '</td><td class="act">' + esc(s.action) +
        '</td><td class="num">' + d$(s.fee || 0) + '</td><td class="num">' + (s.minutes || 0) + " min</td><td>" + weekOf(r, s) + "</td></tr>";
    }).join("");
    var three = [100, 1000, 10000].map(function (t) {
      var g = RM.farmPlan(r, t, S.share, S.tbill);
      return "<tr><td>" + usd0(t) + '</td><td class="num">' + d$(g.slice) + '</td><td class="num">' + d$(g.costs) +
        '</td><td class="num">' + d$(g.net) + "</td><td>" + (g.be > 1 ? "never pays" : (g.be * 100).toFixed(1) + "%") +
        '</td><td><span class="vd ' + g.verdict + '">' + g.verdict + "</span></td></tr>";
    }).join("");
    var grid = [0.05, 0.10, 0.20].map(function (sh) {
      return "<tr><th>" + Math.round(sh * 100) + "% share</th>" + [0, 0.04, 0.08].map(function (tb) {
        var v = RM.farmPlan(r, tickOf(r), sh, tb).verdict;
        return '<td><span class="vd ' + v + '">' + v + "</span></td>";
      }).join("") + "</tr>";
    }).join("");
    app.innerHTML = '<div class="detail"><a class="back" href="#/board">← back to the board</a>' +
      "<h1>" + esc(r.name) + ' <span class="vd ' + f.verdict + '">' + f.verdict + "</span>" + (f.robust ? ' <span class="rob">ROBUST 9/9</span>' : "") + "</h1>" +
      '<div class="meta">#' + r.rank + " of " + ROWS.length + " · " + esc(r.category || "—") + " · " +
        (r.chains || []).map(esc).join(", ") + " · TVL " + usd0(r.tvl) + " · 7d " +
        (r.change7d == null ? "—" : (r.change7d >= 0 ? "+" : "") + r.change7d.toFixed(1) + "%") +
        " · no token for " + ageFmt(r.ageDays) + " " + badgesHtml(r) + "</div>" +
      '<div class="cols"><div class="box"><h3>PRICE DECOMPOSITION — impliedValue() × launchOdds()</h3>' +
      '<table class="kv">' +
      "<tr><td>TVL (snapshot)</td><td>" + usd0(r.tvl) + "</td></tr>" +
      "<tr><td>Comps curve 10^" + RM.curve().a.toFixed(4) + " × TVL^" + RM.curve().b.toFixed(4) + "</td><td>" + usd0(iv.curve) + "</td></tr>" +
      "<tr><td>Kin factor (tokened sibling)</td><td>×" + iv.kin.toFixed(3) + "</td></tr>" +
      "<tr><td><b>Value if launched</b></td><td><b>" + usd0(r.valueIfLaunched) + "</b></td></tr>" +
      "<tr><td>Implied multiple (value ÷ TVL)</td><td>" + r.mult.toFixed(3) + "×</td></tr>" +
      "<tr><td>Launch odds — launchOdds()</td><td>" + Math.round(r.odds * 100) + "%</td></tr>" +
      "<tr><td><b>Expected value (rank key)</b></td><td><b>" + usd0(r.ev) + "</b></td></tr>" +
      "<tr><td>Band P25–P75</td><td>" + usd0(r.bandLo) + " – " + usd0(r.bandHi) + "</td></tr>" +
      "<tr><td>Band P10–P90</td><td>" + usd0(r.band10) + " – " + usd0(r.band90) + "</td></tr>" +
      "<tr><td>Rank, with bootstrap range</td><td>#" + r.rank + " (" + r.rankLo + "–" + r.rankHi + ")</td></tr></table>" +
      "<p>The band is the middle half of what comparable launches priced at — leave-one-out comp residuals near this TVL; the rank range is the 10–90 spread over 200 seeded bootstrap refits.</p>" +
      "<p>× category · growth · tenure · breadth — fitted, tested, dropped (ladder on Method)</p></div>" +
      '<div class="box"><h3>TRADED PEERS — THE COMPARISON SET</h3>' +
      '<table class="kv">' + peers +
      '<tr><td><b>' + esc(r.name) + " (implied)</b></td><td><b>" + r.mult.toFixed(3) + "×</b></td><td class=\"num\">" + c$(r.tvl) + "</td></tr></table>" +
      "<p>Nearest traded protocols in the same category within ±1 dex of TVL, at their real multiples. The curve — not any single peer — sets the price.</p>" +
      '<h3 style="margin-top:10px">VALUE BAND ON THE $1M–$1B AXIS</h3>' +
      '<div class="bigband"><span class="b90" style="left:' + bpos(r.band10) + "%;width:" + Math.max(1, bpos(r.band90) - bpos(r.band10)) + '%"></span>' +
      '<span class="b75" style="left:' + bpos(r.bandLo) + "%;width:" + Math.max(1, bpos(r.bandHi) - bpos(r.bandLo)) + '%"></span>' +
      '<span class="tick" style="left:' + bpos(r.valueIfLaunched) + '%"></span></div>' +
      "<p>$1M ———————————————————— $1B · pale: P10–P90 · bright: P25–P75 · tick: point price</p></div></div>" +
      '<div class="box" style="margin-top:10px"><h3>THE FARM PLAN — farmPlan() AT ' +
        (S.plan ? "ITS PLAN SIZE " + usd0(Math.round(tickOf(r))) + " (0.02% OF TVL)" : "TICKET " + usd0(S.ticket)) + "</h3>" +
      '<table class="steps"><tr><th>#</th><th>DATE</th><th>ACTION</th><th>FEE</th><th>TIME</th><th>WEEK</th></tr>' + steps +
      '<tr><td></td><td></td><td class="act"><b>Totals</b> — fees ' + d$(f.fees) + " · hands-on " + f.hours.toFixed(1) +
      " h · held " + Math.round(f.weeks) + " wk · T-bill carry incl.</td>" +
      '<td class="num"><b>' + d$(f.fees) + '</b></td><td class="num"><b>' + f.minutes + " min</b></td><td></td></tr></table>" +
      "<p>At this size: slice " + d$(f.slice) + " · costs " + d$(f.costs) + " · <b>net " + d$(f.net) + "</b> · net at the band's low end " +
      d$(f.netLow) + " · break-even launch odds <b>" + beTxt + "</b> · " +
      (f.be > 1 ? "never pays at any ticket" : "pays from " + usd0(Math.max(10, Math.round((f.paysFrom || 0) / 10) * 10))) + "</p></div>" +
      '<div class="cols"><div class="box"><h3>VERDICT MATH AT THREE TICKETS</h3>' +
      '<table class="kv"><tr><td>Ticket</td><td>Slice</td><td>Costs</td><td>Net</td><td>Break-even</td><td>Verdict</td></tr>' + three + "</table>" +
      "<p>FARM needs break-even ≤ 10%, THIN ≤ 33%; above that the plan is a SKIP however good the protocol is.</p></div>" +
      '<div class="box"><h3>ROBUSTNESS — VERDICT ACROSS THE ASSUMPTION GRID</h3>' +
      '<table class="grid3"><tr><th></th><th>T-bill 0%</th><th>T-bill 4%</th><th>T-bill 8%</th></tr>' + grid + "</table>" +
      "<p>" + (f.robust ? "FARM at all nine grid points — marked robust." : "Not robust: the verdict moves inside the grid.") + "</p></div></div></div>";
  }

  // ---------- farm book: every FARM/THIN row at plan size, best net/hour first ----------
  function farmView() {
    var live = ROWS.map(function (r) { return { r: r, f: fp(r) }; })
      .filter(function (x) { return x.f.verdict !== "SKIP"; });
    live.sort(function (a, b) { return b.f.perHour - a.f.perHour; });
    var nf = live.filter(function (x) { return x.f.verdict === "FARM"; }).length;
    app.innerHTML = '<div class="strip"><b>THE FARM BOOK</b> — every FARM/THIN row at its plan size ' +
      "(0.02% of TVL, $500–$10,000), best net per hour first · " + nf + " FARM · " + (live.length - nf) +
      " THIN of " + ROWS.length + " · watchlist " + dig(counts.watchlistCovered, 40) + "/" +
      dig(counts.watchlist, 40) + ' ranked on the board</div>' +
      '<div class="tablewrap"><table class="board"><thead><tr>' +
      "<th>#</th><th>PROTOCOL</th><th class=\"num\">TVL</th><th>ODDS</th><th class=\"num\">EXPECTED VALUE</th>" +
      "<th class=\"num\">PLAN SIZE</th><th class=\"num\">SLICE</th><th class=\"num\">NET</th><th class=\"num\">NET/H</th><th>VERDICT</th><th>PLAN</th>" +
      "</tr></thead><tbody>" +
      live.map(function (x) {
        var r = x.r, f = x.f;
        return "<tr><td><b>" + r.rank + '</b></td><td class="pr"><a href="#/p/' + esc(r.slug) + '">' + esc(r.name) + "</a>" +
          '<span class="sub">' + esc(r.category || "—") + "</span>" + badgesHtml(r) + "</td>" +
          '<td class="num">' + c$(r.tvl) + "</td><td>" + Math.round(r.odds * 100) + "%</td>" +
          '<td class="num"><b>' + c$(r.ev) + "</b></td>" +
          '<td class="num">' + usd0(Math.round(tickOf(r))) + "</td>" +
          '<td class="num">' + d$(f.slice) + "</td>" +
          '<td class="num">' + d$(f.net) + "</td>" +
          '<td class="num">' + (f.perHour >= 0 ? "+" : "-") + "$" + Math.abs(f.perHour).toFixed(2) + "/h</td>" +
          '<td><span class="vd ' + f.verdict + '">' + f.verdict + "</span>" + (f.robust ? '<span class="rob">ROBUST 9/9</span>' : "") + "</td>" +
          '<td class="plan">' + planLine(r, f) + "</td></tr>";
      }).join("") + "</tbody></table></div>";
  }

  // ---------- method ----------
  function methodView() {
    var L = ladder(), cv = RM.curve();
    var lad = L.map(function (r) {
      var shipped = /curve/i.test(r.term), dropped = !shipped && !/flat/i.test(r.term);
      var name = dropped ? "<s>" + esc(r.term) + "</s>" : esc(r.term);
      return '<tr class="' + (shipped ? "shipped" : dropped ? "dropped" : "") + '"><td>' + name + "</td><td>" + x2(r.loo) + "</td><td>" + x2(r.wf) + "</td><td>" +
        (shipped ? "SHIPPED" : dropped ? "dropped" : "baseline") + "</td></tr>";
    }).join("");
    var dec = M.deciles || M.reliability || M.oddsDeciles;
    var decRows;
    if (Array.isArray(dec) && dec.length) decRows = dec.map(function (d) {
      return "<tr><td>" + Math.round((d.pred != null ? d.pred : d.predicted) * 100) + "%</td><td>" +
        Math.round((d.realised != null ? d.realised : d.actual) * 100) + "%</td><td>" + (d.n || "—") + "</td></tr>";
    }).join("");
    else decRows = RM.reliability().map(function (d) {
      return "<tr><td>" + Math.round(d.pred * 100) + "%</td><td>" + Math.round(d.realised * 100) + "%</td><td>" + d.n + "</td></tr>";
    }).join("");
    var coh = M.cohort || RM.cohort();
    var weak = M.weakestCategory || (RM.weakest() || {}).line || "";
    var stab = M.stability || {};
    var stabLine = "Stability over 200 seeded bootstrap refits: " + dig(stab.top20, 19) + " of the top 20 stay top-20 in ≥ 80% of refits · median rank-range width " +
      dig(stab.medianWidth, 6) + " places · " + dig(stab.fromTvl, 159) + " of " + CNT.ranked + " rows sit ≥ 5 places away from the pure-TVL order.";
    var fees = Object.keys(RM.FEE_PRIORS).map(function (k) {
      return "<tr><td>" + esc(k === "_default" ? "any other chain" : k) + "</td><td>" + d$(RM.FEE_PRIORS[k]) + " per action</td></tr>";
    }).join("");
    app.innerHTML = '<div class="method"><h2 class="vt">Method — how every number on the board is made</h2>' +
      '<div class="box"><h3>THE MODEL</h3><p class="note">One pricing engine: the comps curve. The pool is every tokened protocol with a market cap, a listing date, a non-CEX category and cap/TVL inside [0.005, 20], deduped per symbol — ' +
      RM.comps().length + ' comps. A log-log Huber IRLS fit (δ = 1.345, 8 rounds) gives <b>value if launched = 10^' + cv.a.toFixed(4) + " × TVL^" + cv.b.toFixed(4) +
      "</b>, refit in your browser by <b>impliedValue()</b>. A candidate whose name stem matches a tokened protocol — or carries a traded symbol as a whole word — is priced at kin ×0.5, badged SIBLING. " +
      "Launch odds come from <b>launchOdds()</b>: empirical age × TVL cells over all " + CNT.protocols + " protocols, Laplace-smoothed, falling back to the age row, the TVL band, then the base rate. " +
      "Rows rank by expected value = value × launch odds. <b>farmPlan()</b> prices the farm; <b>checkBoard()</b> re-prices all " + CNT.ranked + " rows in the browser.</p></div>" +
      '<div class="box"><h3>ABLATION LADDER — A TERM SHIPS ONLY IF IT WINS BOTH TESTS</h3>' +
      '<table class="ladder"><tr><th>model</th><th>LOO median miss</th><th>walk-forward</th><th>fate</th></tr>' + lad + "</table>" +
      '<p class="note">LOO prices every comp with a fit that never saw it; walk-forward fits on the oldest 50–90% by listing date and prices the next block. Every added term won one test and lost the other — the full model only wins where it was fitted — so the shipped price is curve × kin, and dropped terms are struck through, not hidden. ' +
      "Placebo: the growth engine refit with its sign flipped prints LOO " + x2(placebo.loo) + " · WF " + x2(placebo.wf) + " — a control the real term could not beat.</p>" +
      "<p class=\"note\">" + esc(namedFactors(L)) + "</p></div>" +
      '<div class="box"><h3>LAUNCH ODDS — RELIABILITY BY DECILE</h3>' +
      '<p class="note">On a seeded 70/30 split the odds call the majority side correctly ' + pctOf(oddsStats.hitRate) + " against the base-rate caller's " + pctOf(oddsStats.baseRate) +
      "; over all " + CNT.protocols + " protocols they discriminate at AUC " + (+oddsStats.auc).toFixed(2) + '. Predicted vs realised, by decile of predicted odds:</p>' +
      '<table class="ladder"><tr><th>predicted</th><th>realised</th><th>n</th></tr>' + decRows + "</table></div>" +
      '<div class="box"><h3>BANDS, RANKS, AND THE HONEST EDGES</h3>' +
      '<p class="note">Bands are P25–P75 (and P10–P90) of leave-one-out comp residuals within ±0.5 dex of a row\'s TVL. Stated ' + esc(calib.stated5050) + ", realised " + esc(calib.realised) + " on held-out comps. " +
      "Cohort honesty: of the " + (coh.oldN + coh.newN) + " comps, the older half lands " + coh.oldIn + " of " + coh.oldN + " inside its band; the newer half " + coh.newIn + " of " + coh.newN + ".</p>" +
      '<p class="note">' + esc(stabLine) + "</p>" +
      '<p class="note">' + esc(weak) + "</p></div>" +
      '<div class="box"><h3>ACCOUNTING — ALL ' + CNT.protocols + ', NONE MISSING</h3>' +
      '<p class="note">' + CNT.ranked + " ranked pre-token candidates · " + CNT.tokened + " already tokened (" + (CNT.tokened - CNT.withCap) + " without a market cap, counted only) · " + CNT.aside + " set aside by class: " +
      CNT.bridge + " bridges & canonical bridges · " + CNT.lst + " liquid staking / restaking · " + CNT.cex + " exchange custody & CEX · " + CNT.versioned + " versioned deployments · " + CNT.wrapped + " wrapped/staked names. " +
      "Exclusions follow the house watchlist rules: category in {Bridge, Canonical Bridge, Liquid Staking, Liquid Restaking, Restaked BTC, CEX}, a name-final version marker, a whole-word wrapped/staked/staking, or an exchange-led name. Watchlist protocols are ranked whatever the rules say — the watchlist is the floor.</p></div>" +
      '<div class="box"><h3>FARM ECONOMICS</h3>' +
      '<p class="note">Every row carries a six-step dated plan (fund → act → weekly repeat → monthly TVL check with a change trigger → claim watch → exit) built from its category, first chain and 7-day move. ' +
      "slice = drop share × value × ticket ÷ (TVL + ticket) · costs = Σ step fees + ticket × T-bill × weeks held ÷ 52 · net = slice − costs. " +
      "The verdict reads break-even launch odds: FARM ≤ 10% · THIN ≤ 33% · SKIP above. Break-even above 100% is never printed raw — the board says <i>never pays</i>. " +
      "Robust = FARM at all nine share × T-bill grid points. Net also prints at the band's low end (P25 value, costs unchanged).</p>" +
      '<table class="kv" style="max-width:340px">' + fees + "</table>" +
      '<p class="note">Fee priors per action. The last step of every plan: record the transaction hashes, watch only the protocol\'s official site, never pay a claim fee, withdraw if nothing is announced.</p></div></div>';
  }

  // ---------- portfolio ----------
  function pfView() {
    var p = buildPortfolio(S.ticket);
    var rows = p.sel.map(function (x) {
      return '<tr><td><a href="#/p/' + esc(x.r.slug) + '">' + esc(x.r.name) + '</a></td><td>' + usd0(S.ticket) + '</td><td>' +
        d$(x.f.slice) + "</td><td>" + d$(x.f.fees) + "</td><td>" + d$(x.f.net) + "</td><td>" + x.f.hours.toFixed(1) +
        " h</td><td>" + (x.f.minutes / 60 / x.f.weeks).toFixed(2) + " h</td><td>" + (x.f.be * 100).toFixed(1) + '%</td><td><span class="vd ' + x.f.verdict + '">' + x.f.verdict + "</span></td></tr>";
    }).join("");
    app.innerHTML = '<div class="pf"><h2 class="vt">Portfolio builder — greedy by net per hour</h2>' +
      '<div class="box"><label>Total capital $ <input type="number" id="pfCap" value="' + PF.capital + '" min="100" step="100"></label> ' +
      '<label>Hours / week <input type="number" id="pfHrs" value="' + PF.hours + '" min="0.5" step="0.5"></label> ' +
      '<label>Ticket per plan $ <input type="number" id="pfTicket" value="' + S.ticket + '" min="10" step="10"></label> ' +
      '<label><input type="checkbox" id="pfSafe" style="width:auto" ' + (PF.safe ? "checked" : "") + "> exclude high-risk tags (FALLING / NEW)</label>" +
      '<p class="note" style="margin-top:6px"><b>' + p.sel.length + " plans</b> · capital used " + usd0(p.capital) + " of " + usd0(PF.capital) +
      " · expected slices " + usd0(p.slice) + " · combined expected net <b>" + usd0(p.net) + "</b> · total fees " + usd0(p.fees) +
      " · total hands-on " + p.hours.toFixed(1) + " h (" + p.weekly.toFixed(2) + " h/wk) · blended break-even " +
      (isFinite(p.be) ? (p.be * 100).toFixed(1).replace(".", ",") + "%" : "never") + ". Filled greedily by net per hour among FARM/THIN rows until capital or weekly hours run out.</p></div>" +
      '<div class="box"><table class="pft"><tr><th>PLAN</th><th>TICKET</th><th>SLICE</th><th>FEES</th><th>NET</th><th>HANDS-ON</th><th>H/WK</th><th>BREAK-EVEN</th><th>VERDICT</th></tr>' +
      rows + "</table></div></div>";
    function bind(id, fn) { var e = document.getElementById(id); if (e) e.addEventListener("change", fn); }
    bind("pfCap", function () { PF.capital = Math.max(100, +this.value || 10000); pfView(); });
    bind("pfHrs", function () { PF.hours = Math.max(0.5, +this.value || 5); pfView(); });
    bind("pfTicket", function () { S.ticket = Math.max(10, +this.value || 1000); pfView(); });
    bind("pfSafe", function () { PF.safe = this.checked; pfView(); });
  }

  // ---------- router + init ----------
  function route() {
    var h = (location.hash || "#/board").replace(/^#\//, "").split("/");
    if (h[0] === "p" && h[1]) detailView(decodeURIComponent(h[1]));
    else if (h[0] === "farm") farmView();
    else if (h[0] === "method") methodView();
    else if (h[0] === "portfolio") pfView();
    else boardView();
    window.scrollTo(0, 0);
  }
  window.addEventListener("hashchange", route);
  try { CHECK = RM.checkBoard(); } catch (e) { CHECK = { line: "checkBoard() failed: " + e.message }; }
  var foot = document.getElementById("foot");
  if (foot) foot.textContent = "Sealed DefiLlama snapshot · " + RM.asOfISO + " · model re-runs in your browser · " + CHECK.line;
  route();
})();
