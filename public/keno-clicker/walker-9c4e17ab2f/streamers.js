/* ═══════════════════════════════════════════════════════════════════════
   KENO IDLE — the hired help.

   Loaded by index.html after the game script, so everything here can see
   S, pays(), draw10(), money() and friends. It is a separate file only
   because the roster is the part you will edit most and it should not mean
   scrolling past the keno engine every time.

   THE ROSTER IS DATA. Every streamer is one row below. Renaming them,
   reordering them, or adding a sixth is an edit to STREAMERS and nothing
   else — the shop, the tick, the save and the hover preview all read it.

   THE NAMES ARE MADE UP ON PURPOSE. Swap in whoever you actually want; it
   is one string each. They are placeholders rather than real people
   because the flavour text calls them drooling idiots.
   ═══════════════════════════════════════════════════════════════════════ */

/* TIER PAYBACK DOUBLES, which is Cookie Clicker's shape. Theirs go 2.5min,
   2.3, 4.3, 8.3, 16.7, 42.7min, 2.1h, 5.4h — each tier costing about 12x more
   while producing only about 5.7x more, so the first purchase of a tier takes
   roughly twice as long to repay itself as the tier below.

   Ours were nearly flat — 1.74h, 1.80h, 1.98h, 2.78h, 4.57h, ratios of 1.03
   to 1.64 — which made the roster read as five interchangeable buttons rather
   than a ladder. Prices below are set so payback doubles: 1.74h, 3.5h, 7h,
   Recomputed after the base match dropped from 4x to 2x, which lowered every
   streamer's earnings and so moved every price: 2.9h, 5.8h, 11.6h, 23.1h, 46h.

   ── REBALANCED 2026-08-25: every hire price x0.25, every bet x2.5 ────────
   HIRING WAS A ROUNDING ERROR AND THE NUMBERS SAID SO. Simulated, the first
   Lurker raised total income by 1.4% — and under optimising play by 0.02%,
   because by the time you had a thousand dollars your own board was earning
   $1.5M an hour. A payback of 2.9h looked perfectly healthy the whole time,
   which is exactly why this went unseen: payback is cost over gain and both
   were tiny. The number that matters is

       lift = (hours of income the hire costs) / (its payback in hours)

   and at $1,000 against $24.6k/h that is 0.041 / 2.9 = 1.4%.

   Ten times the earnings per dollar (x2.5 output on x0.25 price) puts the
   first Lurker at +59%, and the ladder still doubles because every tier
   moved together: 17.4m, 34.7m, 69.2m, 2.3h, 4.6h.

   Scaling the BET rather than the rate on purpose — rate is how fast they
   click, and a Lurker clicking 375 times a second is not a Lurker.

   cost is in CENTS, like every other amount in this game.
   rate  = draws per second, per clone, before any smarts upgrade
   bet   = cents their board plays, before any bet upgrade
   picks = numbers their board plays, before any numbers upgrade */
var STREAMERS = [
  { id:"lurker",  icon:"\u{1F441}", name:"The Lurker",
    blurb:"Has the stream open. Is not watching it.",
    cost:25000, rate:0.8, bet:20, picks:2 },

  { id:"clipper", icon:"\u{2702}", name:"Clip Farmer",
    blurb:"Clips everything. Watches nothing. Clicks between clips.",
    cost:750000, rate:1.2, bet:100, picks:3 },

  { id:"goblin",  icon:"\u{1F47A}", name:"Sub Goblin",
    blurb:"Screams for subs. Presses the button on the vowels.",
    cost:20750000, rate:1.6, bet:625, picks:4 },

  { id:"tilted",  icon:"\u{1F621}", name:"Rage Quitter",
    blurb:"Furious. Fast. Has broken four keyboards on this board.",
    cost:468750000, rate:2.0, bet:3750, picks:5 },

  { id:"algo",    icon:"\u{1F916}", name:"The Algorithm",
    blurb:"Not technically a person. Nobody has asked.",
    cost:9750000000, rate:2.5, bet:22500, picks:6 }
];
function sdef(id){ for (var i=0;i<STREAMERS.length;i++) if (STREAMERS[i].id===id) return STREAMERS[i]; return null; }

/* HOW STUPID THEY CURRENTLY ARE. The smarts track is the rate track wearing
   a costume — one dial, not two, because "clicks faster" and "spaces out
   less often" are the same number and shipping both would be the same
   upgrade sold twice. */
var SMARTS = ["drooling","vacant","blinking","awake","paying attention",
              "focused","sharp","locked in","cracked","ascended"];
var MAX_SMART = SMARTS.length - 1;

/* Cost curves hang off the streamer's own hire price, so a new roster row
   prices its whole upgrade tree automatically. Each one grows faster than
   the effect it buys — x3 against x1.5, x4 against x2, x5 against a
   shrinking (k+1)/k — which is the rule that stops a track paying for
   itself forever. */
function smartCost(def, lvl){ return Math.round(def.cost * 2   * Math.pow(3, lvl)); }
function sbetCost (def, lvl){ return Math.round(def.cost * 1.5 * Math.pow(4, lvl)); }
function spickCost(def, lvl){ return Math.round(def.cost * 3   * Math.pow(5, lvl)); }
function hireCost (def, owned){ return Math.round(def.cost * Math.pow(1.15, owned)); }

function maxPicksFor(def){ return 10 - def.picks; }        /* the ten-tile cap */
var MAX_SBET = 12;

/* ── you have to earn the right to upgrade ─────────────────────────────
   COOKIE CLICKER'S THRESHOLDS, VERBATIM: a building's tier upgrades unlock
   at 1, 5, 25, 50, 100, 150, 200... of that building owned, and each tier
   doubles its output. The gate is the point — it is what stops you buying
   one grandma and immediately maxing her, and it is why the natural loop is
   "buy a lot of these, then their upgrades open up".

   Ours had no such gate: every streamer track was a pure cost ladder you
   could run to the top holding a single clone. Now each level of smarts,
   bet and numbers needs a matching number of that streamer on the payroll,
   so hiring and upgrading pull against each other instead of upgrading
   simply always winning. */
var TIER_THRESHOLDS = [1, 5, 25, 50, 100, 150, 200, 250, 300, 350, 400, 450, 500];
function tierNeeds(lvl){
  return TIER_THRESHOLDS[Math.min(lvl, TIER_THRESHOLDS.length - 1)];
}
function trackOpen(st, lvl){ return st && st.n >= tierNeeds(lvl); }

/* the live numbers for one streamer type */
function sRate (def, st){ return def.rate  * Math.pow(1.5, st.smart); }
function sBet  (def, st){ return def.bet   * Math.pow(2,   st.bet); }
/* CAPPED BY THE BOARD as well as by ten. A streamer carrying five numbers
   onto a four-tile board would be paid for five while only four could ever
   be drawn, and the bulk settle -- which trusts k rather than counting --
   would quietly mint money. */
function sPicks(def, st){ return Math.min(maxPicks(), def.picks + st.picks); }
/* Exact, not estimated: SMOOTH pays (k+1) a hit and a draw of D from N
   averages k*D/N hits, so one draw is worth bet * k(k+1)*D/N whatever size
   the board currently is. */
function sPerSec(def, st){
  var k = sPicks(def, st);
  return st.n * sRate(def, st) * sBet(def, st) * kenoTargetRTP(k);
}

function streamerCentsPerSec(){
  var total = 0;
  for (var i=0;i<STREAMERS.length;i++){
    var def = STREAMERS[i], st = S.streamers[def.id];
    if (st && st.n > 0) total += sPerSec(def, st);
  }
  return total;
}

function rollBoard(k){
  var pool = POOL.slice();
  shuffle(pool);
  return pool.slice(0, k).sort(function(a,b){ return a-b; });
}
function ensureStreamer(id){
  if (!S.streamers[id]){
    var def = sdef(id);
    S.streamers[id] = { n:0, smart:0, bet:0, picks:0, draws:0, carry:0, centsCarry:0,
                        board: rollBoard(def.picks), last:null };
  }
  return S.streamers[id];
}

/* ═══════════════════════════════ the tick ═════════════════════════════
   Draws are resolved for real up to a budget, then settled in bulk.

   THE BULK PATH IS EXACT, NOT AN APPROXIMATION. A draw on k numbers
   returns exactly bet x k cents by construction, so `rest * bet * k` is
   the true total in whole cents — no float accumulator, no drift, no
   fractional cents. The only thing the bulk path loses is the variance,
   which is why the live budget exists at all: somebody has to actually hit
   the jackpots, and it should be the board you can see. */
var LIVE_DRAWS_PER_TICK = 400;

function resolveDraws(def, st, n, budget){
  var k = sPicks(def, st), betC = sBet(def, st), tab = pays()[k] || {};
  var live = Math.min(n, budget.left), gained = 0;
  for (var i=0;i<live;i++){
    var d = draw10(), h = 0;
    for (var j=0;j<d.length;j++) if (st.board.indexOf(d[j]) !== -1) h++;
    var m = tab[h] || 0;
    gained += betC * m;
    st.last = { drawn:d, hits:h, mult:m, payCents: betC * m };
  }
  budget.left -= live;
  var rest = n - live;
  if (rest > 0){
    /* THE REMAINDER SETTLES AT ITS EXACT EXPECTATION, and the fraction is
       carried rather than rounded. A draw is worth bet * k(k+1)*D/N cents,
       which is usually not a whole number — so the whole numerator is
       accumulated over N and only whole cents are paid out, with the leftover
       (0 to N-1) held on the streamer until it adds up. Rounding here instead
       would leak money every single tick.

       THE DIVISOR IS THE TILE COUNT, NOT FOUR. It was four for as long as the
       board was 40 tiles and 10 balls; the carry was never about quarters, it
       was about D/N. A board that grows and a carry that did not follow it
       would be wrong by the ratio between the two sizes. */
    var num = rest * betC * k * (k + 1) * BOARD.drawn + st.centsCarry;
    gained += Math.floor(num / BOARD.tiles);
    st.centsCarry = num % BOARD.tiles;
  }
  st.draws += n;
  return gained;
}

/* THE CLOCK IS SEPARATE FROM THE ARITHMETIC on purpose. advanceStreamers()
   takes the elapsed seconds as an argument and touches nothing else, so how
   many draws a second of game time buys can be checked exactly — a test
   that reads the wall clock instead would be measuring the browser's timer
   throttling, which drops to about 1Hz the moment the tab is hidden. */
function advanceStreamers(dt){
  var budget = { left: LIVE_DRAWS_PER_TICK }, gained = 0, drew = false;
  for (var i=0;i<STREAMERS.length;i++){
    var def = STREAMERS[i], st = S.streamers[def.id];
    if (!st || st.n <= 0) continue;
    st.carry += st.n * sRate(def, st) * dt;
    var n = Math.floor(st.carry);
    if (n <= 0) continue;
    st.carry -= n;
    gained += resolveDraws(def, st, n, budget);
    drew = true;
  }
  if (gained > 0){ S.cents += gained; S.wonCents += gained; }
  return { gained: gained, drew: drew };
}

var lastTickAt = 0;
function streamerTick(){
  var now = (window.performance && performance.now) ? performance.now() : 0;
  if (!lastTickAt){ lastTickAt = now; return; }
  /* CAPPED, because a backgrounded tab throttles this timer to about once a
     second and a long absence would otherwise arrive as one enormous
     payout. Offline earnings are a feature, not an accident of dt — until
     they are built, time away is simply not paid. */
  var dt = Math.min((now - lastTickAt) / 1000, 1);
  lastTickAt = now;
  if (dt <= 0) return;
  var r = advanceStreamers(dt);
  if (r.drew){ paintStreamersLive(); paintLive(); if (peekId) paintPeek(); save(); }
}

/* ═══════════════════════════════ buying ═══════════════════════════════ */
function hire(id, free){
  var def = sdef(id); if (!def) return false;
  var st = ensureStreamer(id), cost = hireCost(def, st.n);
  if (!free){
    if (S.cents < cost) return false;
    S.cents -= cost;
  }
  st.n += 1;
  return true;
}
function upgradeStreamer(id, track, free){
  var def = sdef(id); if (!def) return false;
  var st = ensureStreamer(id);
  if (st.n <= 0) return false;
  var lvl, cost, cap;
  if (track === "smart"){ lvl = st.smart; cap = MAX_SMART;          cost = smartCost(def, lvl); }
  else if (track === "bet"){ lvl = st.bet; cap = MAX_SBET;          cost = sbetCost(def, lvl); }
  else if (track === "picks"){ lvl = st.picks; cap = maxPicksFor(def); cost = spickCost(def, lvl); }
  else return false;
  if (lvl >= cap) return false;
  if (!trackOpen(st, lvl)) return false;         /* not enough of them hired */
  if (!free){
    if (S.cents < cost) return false;
    S.cents -= cost;
  }
  if (track === "smart") st.smart += 1;
  else if (track === "bet") st.bet += 1;
  else {
    st.picks += 1;
    /* A NEW NUMBER MEANS A NEW BOARD, same rule the player's own board
       follows: the tiles showing were scored against the old selection. */
    st.board = rollBoard(sPicks(def, st));
    st.last = null;
  }
  return true;
}

/* ═══════════════════════════════ painting ═════════════════════════════
   Two functions on purpose. paintStreamersFull() rebuilds the markup and
   is called only when the shape changes; paintStreamersLive() writes into
   the nodes it left behind and is called ten times a second.

   REBUILDING THE ROWS ON EVERY TICK WOULD BREAK THE HOVER. Replacing the
   element under the cursor fires mouseleave and never fires mouseenter
   again, so the board preview would flicker out the instant a streamer
   drew — which is exactly when you are looking at it. */
var sEls = {}, rowSig = null;

/* THE ROSTER IS HIDDEN UNTIL IT IS NEARLY IN REACH — the whole row, not a
   silhouette of it. Five names and five prices you cannot touch is a wall to
   scroll past, not a goal to aim at; showing only what you are within a fifth
   of keeps the card the size of the decision in front of you.

   Same sticky peak-balance rule the shop uses, so nothing you have already
   unlocked disappears when you spend on it. */
function rowSeen(def, owned){ return owned > 0 || revealed(hireCost(def, 0)); }

/* WHAT WOULD REQUIRE NEW MARKUP rather than new numbers. Owning your first
   of a type adds its upgrade row; crossing the reveal threshold swaps the
   silhouette for a name. Everything else is text, and text is written in
   place so the hover survives. */
function streamerRowSig(){
  var s = DEV ? "d|" : "-|";
  for (var i=0;i<STREAMERS.length;i++){
    var def = STREAMERS[i], st = S.streamers[def.id], owned = st ? st.n : 0;
    var gates = st ? (trackOpen(st, st.smart)?"1":"0") + (trackOpen(st, st.bet)?"1":"0") +
                     (trackOpen(st, st.picks)?"1":"0") : "---";
    s += def.id + (owned > 0 ? "y" : "n") + (rowSeen(def, owned) ? "s" : "-") + gates + "|";
  }
  return s;
}

/* WHAT ONE MORE OF THIS IS WORTH, PER HOUR. Marginal, not total: income
   with the purchase minus income without it, so the four tracks can be
   compared against each other and against their prices. Developer only. */
function streamerGainPerHour(def, st, track){
  var base = st || { n:0, smart:0, bet:0, picks:0 };
  var n = base.n, rate = sRate(def, base), bet = sBet(def, base), k = sPicks(def, base);
  var now = n * rate * bet * kenoTargetRTP(k), next;
  if (track === "hire")       next = (n+1) * rate * bet * kenoTargetRTP(k);
  else if (track === "smart") next = n * rate * 1.5 * bet * kenoTargetRTP(k);
  else if (track === "bet")   next = n * rate * bet * 2 * kenoTargetRTP(k);
  else if (track === "picks") next = n * rate * bet * kenoTargetRTP(Math.min(10, k+1));
  else return 0;
  return (next - now) * 3600;
}
function sGainTag(def, st, track){
  var g = streamerGainPerHour(def, st, track);
  return g > 0 ? "+" + money(Math.round(g)) + "/hr" : "";
}

function trackBtn(def, st, track, lvl, cap, cost, label){
  var maxed = lvl >= cap, open = trackOpen(st, lvl);
  var can = !maxed && open && S.cents >= cost;
  /* A LOCKED TRACK NAMES ITS PRICE IN PEOPLE, not in money — "needs 25" is
     an instruction, "$4,000" while greyed out is just a puzzle. */
  var face = maxed ? "max" : !open ? ("needs " + tierNeeds(lvl)) : money(cost);
  return '<button class="sbtn' + (can ? " can" : "") + (!open && !maxed ? " shut" : "") +
         '" data-sup="' + def.id + '" data-track="' + track + '"' +
         (can ? "" : " disabled") + ' title="' + label + '">' +
         '<i>' + label + ' ' + lvl + '</i>' +
         '<b>' + face + '</b>' +
         (DEV ? '<u>' + (maxed || !open ? "" : sGainTag(def, st, track)) + '</u>' : '') +
         '</button>';
}

function paintStreamersFull(){
  var html = "";
  for (var i=0;i<STREAMERS.length;i++){
    var def = STREAMERS[i], st = S.streamers[def.id];
    var owned = st ? st.n : 0;
    if (!rowSeen(def, owned)) continue;
    var cost = hireCost(def, owned), can = S.cents >= cost;
    html += '<div class="srow' + (owned ? " owned" : "") + '" data-peek="' + def.id + '">' +
      '<div class="sicon">' + def.icon + '</div>' +
      '<div class="smid">' +
        '<div class="sname">' + def.name +
          (owned ? ' <span class="scount">&times;' + owned + '</span>' : '') + '</div>' +
        '<div class="sblurb" id="sb-' + def.id + '">' + def.blurb + '</div>' +
        (owned ? '<div class="strk">' +
            trackBtn(def, st, "smart", st.smart, MAX_SMART,        smartCost(def, st.smart), "smarts") +
            trackBtn(def, st, "bet",   st.bet,   MAX_SBET,         sbetCost(def, st.bet),   "bet") +
            trackBtn(def, st, "picks", st.picks, maxPicksFor(def), spickCost(def, st.picks), "numbers") +
          '</div>' : '') +
      '</div>' +
      '<div class="sbuy">' +
        '<div class="sout" id="so-' + def.id + '">' + (owned ? money(Math.round(sPerSec(def, st))) + "/s" : "") + '</div>' +
        (DEV ? '<div class="devgain" id="sg-' + def.id + '">' + sGainTag(def, st, "hire") + '</div>' : '') +
        '<button class="' + (can ? "primary" : "ghost") + '" data-hire="' + def.id + '"' +
          (can ? "" : " disabled") + '>' + money(cost) + '</button>' +
      '</div></div>';
  }
  /* THE WHOLE CARD GOES, not just its rows. An empty panel headed "The
     hired help" is a promise with nothing behind it; until somebody is
     within reach the column simply is not there.

     TWO THINGS DECIDE THIS AND THEY ARE NOT THE SAME. Whether there is
     anything to show is the game's call and lives here; whether the player
     WANTS to see it is the rail tab's call and lives in applyHelpVisible().
     Setting `hidden` directly from here fought the tab: every streamer repaint
     reopened a panel the player had just closed. */
  helpHasRows = !!html;
  applyHelpVisible();
  $("streamers").innerHTML = html;
  rowSig = streamerRowSig();
  sEls = {};
  for (var j=0;j<STREAMERS.length;j++){
    var id = STREAMERS[j].id;
    if (!$("so-" + id)) continue;
    sEls[id] = { out: $("so-" + id), blurb: $("sb-" + id), gain: $("sg-" + id),
                 hire: document.querySelector('[data-hire="' + id + '"]'),
                 ups: document.querySelectorAll('[data-sup="' + id + '"]') };
  }
}

/* Numbers and affordability only. Touches no structure, so the cursor keeps
   whatever it was hovering. */
function paintStreamersLive(){
  /* Rebuild only when the SHAPE changed — a row revealing itself, or a first
     hire adding its upgrade buttons. Everything else is written in place. */
  if (streamerRowSig() !== rowSig){ paintStreamersFull(); return; }
  for (var i=0;i<STREAMERS.length;i++){
    var def = STREAMERS[i], st = S.streamers[def.id], e = sEls[def.id];
    if (!e || !e.out) continue;
    var owned = st ? st.n : 0;

    if (e.hire){
      var cost = hireCost(def, owned), can = S.cents >= cost;
      e.hire.textContent = money(cost);
      e.hire.disabled = !can;
      e.hire.className = can ? "primary" : "ghost";
    }
    if (e.gain) e.gain.textContent = sGainTag(def, st, "hire");

    /* THE CACHED NODES CAN OUTLIVE THE STREAMER THEY DESCRIBE. Anything
       that drops an entry from S.streamers without a paintStreamersFull()
       — load() replacing the whole map, for one — leaves this function
       holding upgrade buttons for somebody who no longer exists. Reading
       st.smart there threw, and because this runs inside the tick it took
       the tick and its save() down with it, silently. Bail instead. */
    if (owned <= 0) continue;

    e.out.textContent = money(Math.round(sPerSec(def, st))) + "/s";
    e.blurb.textContent = SMARTS[st.smart] + " · " + sRate(def, st).toFixed(2) + " draws/s · " +
                          money(sBet(def, st)) + " on " + sPicks(def, st) + " numbers";

    for (var u=0; u<e.ups.length; u++){
      var b = e.ups[u], track = b.getAttribute("data-track");
      var lvl, cap, cost2;
      if (track === "smart"){ lvl = st.smart; cap = MAX_SMART; cost2 = smartCost(def, lvl); }
      else if (track === "bet"){ lvl = st.bet; cap = MAX_SBET; cost2 = sbetCost(def, lvl); }
      else { lvl = st.picks; cap = maxPicksFor(def); cost2 = spickCost(def, lvl); }
      var maxed = lvl >= cap, open2 = trackOpen(st, lvl);
      var can2 = !maxed && open2 && S.cents >= cost2;
      b.disabled = !can2;
      b.className = "sbtn" + (can2 ? " can" : "") + (!open2 && !maxed ? " shut" : "");
      b.querySelector("i").textContent = b.getAttribute("title") + " " + lvl;
      b.querySelector("b").textContent = maxed ? "max" : !open2 ? ("needs " + tierNeeds(lvl)) : money(cost2);
      var gEl = b.querySelector("u");
      if (gEl) gEl.textContent = (maxed || !open2) ? "" : sGainTag(def, st, track);
    }
  }
}

/* Set by paintStreamersFull, read by applyHelpVisible in index.html. */
var helpHasRows = false;

/* ═══════════════════════ the board they are playing ═══════════════════ */
var peekId = null;
function paintPeek(){
  var def = sdef(peekId), st = S.streamers[peekId];
  if (!def || !st || st.n <= 0){ $("peek").hidden = true; return; }
  var last = st.last, drawn = last ? last.drawn : [];
  var html = "";
  for (var t=1;t<=BOARD.tiles;t++){
    var mine = st.board.indexOf(t) !== -1, hit = drawn.indexOf(t) !== -1;
    html += '<div class="kt' + (mine ? " pick" : "") + (hit ? " drawn" : "") + '">' + t + '</div>';
  }
  $("peekBoard").style.setProperty("--bcols", String(BOARD.cols));
  $("peekBoard").innerHTML = html;
  $("peekName").textContent = def.name + " ×" + st.n;
  $("peekState").textContent = SMARTS[st.smart];
  $("peekFoot").textContent = last
    ? last.hits + " of " + sPicks(def, st) + " · " + (last.payCents > 0 ? "+" + money(last.payCents) : "nothing")
    : "hasn't drawn yet";
  $("peekSub").textContent = money(sBet(def, st)) + " a draw · " + st.draws.toLocaleString() + " draws so far";
}
function showPeek(id, el){
  peekId = id;
  var st = S.streamers[id];
  if (!st || st.n <= 0){ peekId = null; return; }
  var p = $("peek");
  p.hidden = false;
  paintPeek();
  var r = el.getBoundingClientRect(), ph = p.offsetHeight;
  var topPx = Math.max(6, Math.min(window.innerHeight - ph - 6, r.top));
  var leftPx = r.left - p.offsetWidth - 8;
  if (leftPx < 6) leftPx = Math.min(window.innerWidth - p.offsetWidth - 6, r.right + 8);
  p.style.top = topPx + "px";
  p.style.left = leftPx + "px";
}
function hidePeek(){ peekId = null; $("peek").hidden = true; }

/* ═══════════════════════════════ wiring ═══════════════════════════════ */
function initStreamers(){
  $("streamers").addEventListener("click", function(e){
    var h = e.target.closest("[data-hire]");
    if (h){ if (hire(h.getAttribute("data-hire"), false)){ paintStreamersFull(); paint(); flush(); } return; }
    var u = e.target.closest("[data-sup]");
    if (u){
      if (upgradeStreamer(u.getAttribute("data-sup"), u.getAttribute("data-track"), false)){
        paintStreamersFull(); paint(); flush();
        if (peekId) paintPeek();
      }
    }
  });
  $("streamers").addEventListener("mouseover", function(e){
    var row = e.target.closest("[data-peek]"); if (!row) return;
    var id = row.getAttribute("data-peek");
    if (id !== peekId) showPeek(id, row);
  });
  $("streamers").addEventListener("mouseleave", hidePeek);
  window.addEventListener("scroll", hidePeek, true);
  setInterval(streamerTick, 100);
}
