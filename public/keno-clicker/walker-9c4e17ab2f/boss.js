/* ══════════════════════════ THE WALKER FIGHT ═══════════════════════════════
   Ported from keno-idle/mockups/walker-intro.html, where the intro beats, the
   spark physics and the four moves were built and tuned. This file is the same
   fight against the REAL board.

   THREE THINGS CHANGED IN THE PORT, and they are the only interesting part:

   1. COORDINATES ARE THE VIEWPORT. The mockup ran inside a 924x618 `.stage`
      and measured everything relative to it. Here the arena IS the window, so
      every rect is used raw and `#bossFx` is `position:fixed; inset:0` — the
      same frame `#starFx` already uses, which is why the two can share a
      coordinate system without either knowing about the other.

   2. THE BOARD IS THE GAME'S BOARD. The mockup emptied `#board` and kept the
      frame; here `paintBoard()` owns those elements and rewrites their
      classes on every repaint, so emptying it would simply be undone on the
      next draw. Tiles are marked in `bossDead` instead and paintBoard folds
      that into the class it was going to write anyway — the same shape the
      takeover already uses for `bwKnocked`.

   3. THE GAME ALREADY HAS SOUND. `thud()`, `audio()` and `S.muted` are its
      own, with a different signature to the mockup's, so the fight uses them
      rather than opening a second AudioContext beside the first.

   HOW THE FIGHT WORKS, in one paragraph, because the mechanic is not obvious
   from the code: Walker's knotwork ring is his shield AND his health bar. It
   is five segments and every one you break is cut out of the art, so you read
   his health by looking at him. When he fires the AOE the sparks come out
   through everything still standing — so the sector you broke is the only
   place that cannot hurt you, and the answer to the attack is to stand in the
   damage you already did. The more of him is missing the faster he spins, so
   winning makes the safe spot harder to hold. Damage comes from holding SPACE,
   which only works while the board is whole; he smashes it, you rebuild it by
   standing on it. Every move he has is an attempt to keep you off that frame. */

(function(){
"use strict";

var $ = function(id){ return document.getElementById(id); };

/* ── art ───────────────────────────────────────────────────────────────── */
var ART = {
  idleRing:"../boss/walker_idle_ring.png", idleHead:"../boss/walker_idle_head.png",
  demonRing:"../boss/walker_ring.png",     demonHead:"../boss/walker_head.png"
};
var IMG = {}, artLeft = 0;
var VOICE = ["greeting","whatdidyousay","fuckyou","goatblast","irrelevant"];
var BUF = {}, voices = [];
var MUSIC = null, MUSIC2 = null;
/* which element is live, and how wide the overlap is */
var MUSIC_CUR = null, MUSIC_VOL = 0.55, CROSSFADE_S = 4.0;
/* ════════════════════ ONE VOLUME, AND IT SURVIVES THE TAB ════════════════════
   MUSIC_VOL and SFX_VOL are MIX levels - they set how loud the soundtrack sits
   against the cues, and they are not the player's business. What the player
   wants is one knob over the top of both, so this scales them rather than
   replacing them and the mix stays where it was set.

   Every read of MUSIC_VOL goes through musVol() now. Leaving even one direct
   read behind would mean the crossfade quietly restored full volume four
   seconds before the end of every loop, which is the kind of bug that only
   shows up in the one place nobody is listening for it. */
var VOL_KEY = "kenoidle.walker.vol";
var MASTER = (function(){
  try {
    var v = parseFloat(localStorage.getItem(VOL_KEY));
    return isFinite(v) ? Math.max(0, Math.min(1, v)) : 1;
  } catch(e){ return 1; }
})();
function musVol(){ return MUSIC_VOL * MASTER; }
function setVolume(v){
  MASTER = Math.max(0, Math.min(1, (+v) || 0));
  try { localStorage.setItem(VOL_KEY, String(MASTER)); } catch(e){}
  if (SFX_GAIN) SFX_GAIN.gain.value = SFX_VOL * MASTER;
  /* only the element that is actually playing - setting the idle one would
     undo the crossfade's ramp the moment it started */
  try { if (MUSIC  && !MUSIC.paused)  MUSIC.volume  = musVol(); } catch(e){}
  try { if (MUSIC2 && !MUSIC2.paused) MUSIC2.volume = musVol(); } catch(e){}
  return MASTER;
}
/* ════════════════════ THE CROSSFADE, STEPPED FROM THE FRAME ════════════════════
   Called every frame while the arena is up. It does nothing at all until the
   live element is within CROSSFADE_S of its end, then starts the other one and
   ramps the pair past each other. equal-power rather than linear, or the
   overlap dips in the middle and the seam is audible for the opposite reason. */
function musicStep(){
  if (!MUSIC || !MUSIC2 || muted()) return;
  var cur = MUSIC_CUR || MUSIC, other = (cur === MUSIC) ? MUSIC2 : MUSIC;
  if (!cur.duration || !isFinite(cur.duration)) return;
  var left = cur.duration - cur.currentTime;
  if (left > CROSSFADE_S){
    if (other.paused) cur.volume = musVol();
    return;
  }
  if (other.paused){
    try { other.currentTime = 0; var p = other.play(); if (p && p.catch) p.catch(function(){}); }
    catch(e){ return; }
  }
  var t = Math.max(0, Math.min(1, 1 - left/CROSSFADE_S));
  cur.volume   = musVol() * Math.cos(t*1.5708);
  other.volume = musVol() * Math.sin(t*1.5708);
  if (left <= 0.06){
    try { cur.pause(); cur.currentTime = 0; } catch(e){}
    cur.volume = 0; other.volume = musVol();
    MUSIC_CUR = other;
  }
}
var autoWas = null;             /* the game's auto-play state, held for the exit */

/* ── geometry ──────────────────────────────────────────────────────────── */
/* HIS SIZE COMES FROM THE ARENA, NOT FROM A CONSTANT. 165 was tuned against a
   924x618 mockup with a three-column board; the real game is a full window with
   a 514px board, and at 165 he read as a trinket hanging over it rather than as
   the thing you are fighting. A third of the viewport height puts him at ~270
   on a 820px screen — the proportion a boss wants against the thing it is
   attacking. */
var WALK = 165;                 /* recomputed by sizeWalker(); scale 1 = arrived */
/* THE RIGHT-HAND LIMIT OF THE ARENA, as a fraction of the width. He stations at
   0.82, so this leaves clear air in front of him and no way round the back. */
var PLAY_MAX_X = 0.66;   /* a little less room than 0.74 — he sits at 0.76 */
/* HE CLEARS THE BOARD NOW; HE USED TO BITE INTO IT. The overlap was argued for
   on the grounds that a figure clear of the board reads as a picture hung above
   it — true when he was 165px against a 201px board and they were comparable
   objects. At ~280 against a board that can be 200 wide he is simply BIGGER
   than the thing he is standing on, and the same overlap stopped reading as
   depth and started reading as him sitting on top of the tiles, hiding the row
   you are trying to play. Positive means a gap. */
var HOVER_GAP = 30;
function sizeWalker(){
  WALK = Math.max(200, Math.min(340, Math.round(VH() * 0.34)));
  HOVER_GAP = Math.round(WALK * 0.16);
  var el = $("walker");
  if (el){ el.style.width = el.style.height = WALK + "px"; }
}
var W = { x:0, y:0, scale:1, ang:0, spin:0.004, demon:0, shake:0 };
/* YOU ARE A PIECE OF THE BOARD HE BROKE.
   Mih was the placeholder and he was always slightly beside the point: a face
   with no relationship to the thing being fought over. A shard of the keno
   board is the same silhouette as everything else drifting through the arena,
   it is made of the palette the game already owns, and it says what the fight
   is about without a line of dialogue — he smashed the board, and what is left
   of the board is coming for him.

   IT IS DRAWN, NOT AN IMAGE. A triangle in the tile's own colours costs no
   asset, scales to any board size, and can carry state an image cannot: it
   tilts into its own velocity, and it flashes on the frames you are invulnerable
   without needing a second file. */
/* THE HITBOX IS A DOT INSIDE THE TRIANGLE, and this is the single change that
   makes a bullet hell possible. The shard is 52px; what bullets actually hit is
   a 9px core at its centre. Every game in the genre does this and it is not a
   cheat — it is what lets the screen be FULL of bullets while remaining fair,
   because the player reads gaps against a small known point rather than against
   a sprite whose edges they have to guess at. Without it, doubling the bullet
   count just doubles unavoidable damage. */
/* HALF THE HITBOX. 9 -> 4.5. Everything that can hurt you reads P.r — the
   bullet test, the beam's perp < RUNE_H + P.r — so halving it here halves it
   everywhere at once, and drawPlayer draws the dot at exactly P.r so what you
   see shrinks with it. The outer ring is P.r+2.5 and keeps it findable on a
   busy screen at the smaller size. */
var P = { x:0, y:0, vx:0, vy:0, live:false, w:52, h:52, aim:0, r:4.5 };
var P_ACC = 2900, P_DRAG = 0.0012;       /* top speed = ACC / -ln(DRAG) = 430 */
var keys = {};

/* ══════════ THE BOSS CANVASES WERE THE ONLY ONES NOT DPR-AWARE ════════════
   index.html has sized its canvases to Math.min(2, devicePixelRatio) in three
   places since long before any of this. The two canvases boss.js owns did not:
   they set width = VW(), which is CSS pixels, so on any HiDPI screen the
   backing store was HALF the resolution of the box it is stretched across.

   Everything the fight draws lives on those two canvases - the galaxy bullets,
   the shower, the beams - so on a retina display every one of them was an
   upscaled blur. "some people have fuzzy balls for the galaxies and i have the
   actual galaxies" is one number, and this is it. The machine it was written on
   is DPR 1, which is why it always looked right here.

   Capped at 2 like the rest of the file: past that the pixels cost more than
   they show, and this fight is already the heaviest thing on the page. */
function DPR(){
  var d = Math.min(2, window.devicePixelRatio || 1);
  /* the one thing that gives way when frames are being dropped — half the
     linear resolution is a quarter of the fill, and it costs sharpness rather
     than information */
  return QUALITY < 0.85 ? Math.min(1, d) : d;
}
function VW(){ return window.innerWidth; }
function VH(){ return window.innerHeight; }
function boardBox(){
  var el = $("board"); if (!el) return { x:VW()/2, y:VH()*0.72, w:200, h:140, top:VH()*0.65 };
  var r = el.getBoundingClientRect();
  return { x:r.left+r.width/2, y:r.top+r.height/2, top:r.top, w:r.width, h:r.height };
}
/* HE HANGS OFF THE BOARD UNTIL THERE IS NO BOARD, then off the arena. Deriving
   it from a hidden element would give a rect of zeros and drop him into the top
   left corner. */
function restPos(){
  if (boardGone) return { x: VW()/2, y: VH()*0.30 };
  var b=boardBox(); return { x:b.x, y:b.top - WALK/2 - HOVER_GAP };
}
function pC(){ return { x:P.x+P.w/2, y:P.y+P.h/2 }; }

/* ════════════════════ THE FINALE ════════════════════
   He used to not die. At zero health the fight ran BACKWARDS and rewindDone()
   called fightStart(), so the whole thing looped and there was no victory path
   at all - the "WALKER DOWN" screen already existed and was simply unreachable.

   Now the last break IS the death. He rises to the top of the room and pulses
   one enormous slow wall outward; touching it kills you outright, whatever your
   health, and the only ground it never reaches is the far bottom-left corner.
   The moment it arrives there he hits zero, the EMP goes off, the wall and
   every projectile vanish, and he collapses.

   DRIVEN BY HIS HEALTH, NOT BY A CLOCK, and that is the whole trick. The last
   break is deterministic - measured at 602 dps whether the player is parked on
   a tile or hiding in a corner, because in break 4 every tile is already lit
   and damage flows wherever you stand. But it is NOT a fixed duration: 29.9s at
   the $8 bet, 24.0s at level 42, because breakSeconds() shrinks a second per
   upgrade and the pool shrinks with it. A timeline written against 30 seconds
   would desync for everyone not at exactly $8.

   So the radius is a function of how much of him is left. It reaches the corner
   exactly as he reaches zero at EVERY bet size, with no timeline to keep in
   step and nothing to re-tune if the pool changes. */
/* two player lengths was the brief and it left a pocket you could stroll
   around in; 74 is a little over one, which is still a clear near miss and a
   place you have to actually be */
/* seconds into the last phase at which each hide opens. The first comes in
   fast - the phase has barely started and you should already be moving - and
   the second five seconds later, while there is still floor left to cross. */
var FIN_HIDE_AT = [0.8, 7.5];
/* ════════════════════ THE CROSS-LINES: TWO CHOREOGRAPHED SETS ════════════════════
   Perpendicular to the kill line, which in the line's own rotated frame means
   simply horizontal - the same transform draws both, so "perpendicular" is true
   by construction rather than by a second calculation that could drift out of
   step with the first.

   They were a random trickle and are now two SETS, each a comb of lines with
   one gap in it. A set arms top to bottom, then fires top to bottom, coloured
   red at the top through to violet at the bottom - so the cascade reads as one
   deliberate object sweeping down the room rather than as scattered hazards.

   THE LAST SET IS FIXED, AND SO IS THE WAY THROUGH IT. Positions come off a
   spacing grid with a hole punched at a stated offset, so the route is the same
   on every run and can be learned. Set one's hole is up the room; set two's is
   at the corner, which is where the sweep is pushing you anyway - so the last
   thing the fight asks is the thing you were already doing, done exactly.

   ARM IS LONG AND THE KILL IS THIN. 2500ms of white hairline against a 200ms
   pulse, and the lethal half-width is 1.6 against the player's 4.5 - a little
   over six pixels of contact. Everything about the timing says "you have time";
   everything about the width says "be precise". */
/* ════════════════════ THREE SETS, AND THEY ESCALATE ════════════════════
   Per-set arrays rather than one constant each, because a set that repeats
   itself twice is a pattern you solve once. Each one is tighter than the last:
   the comb closes up, the cascade runs faster, and the warning shortens - so
   the first is a puzzle you walk through and the third is one you have to
   already be standing in the answer to.

   THE THIRD LANDS IN THE LAST FIVE SECONDS. 13.5s after the hide ends puts its
   cascade at about 25 to 28 seconds of a thirty second finale, which is the
   stretch that was previously nothing but the sweep closing.

   THE HOLE IS ONE LINE WIDE. Removing everything within GAP_HALF took out three
   lines at a time and left a 368px boulevard - "a huge gap in the shooting
   pulses". Now exactly the one line nearest the route is dropped, so the way
   through is 2 x spacing and closes as the spacing does: 200, 172, 144. */
var RAY_FIRE    = 200;    /* the rainbow pulse */
var RAY_H       = 1.6;    /* half-width of the part that hurts */
var RAY_ARM     = [2500, 2200, 1800];  /* the white hairline, shortening */
var RAY_STAGGER = [110, 88, 64];       /* top-to-bottom cascade, quickening */
var RAY_SPACING = [100, 86, 72];       /* the comb, closing */
/* ════════════════════ SET TWO OPENS WHERE SET ONE LEFT YOU ════════════════════
   Measured at set two's moment: the reachable band is [-426, 614] and its route
   was at +86, while a player who had just solved set one was standing at -300,
   where set two offered nothing but its ordinary 86px spacing. Solving the
   first set put you in the worst place for the second, which is the opposite of
   a route.

   So set two's hole sits where set one's did. The rhythm becomes MOVE, HOLD,
   MOVE: cross for the first, stand still through the second while the comb
   tightens around you, then make the last trip to the corner for the third -
   which is where the sweep has been pushing you the whole time. */
var RAY_GAP_AT  = [-250, -300, 0];     /* where the route is, per set */
var RAY_AT      = [4.0, 8.0, 13.5];    /* seconds after the hide ends */
var RAY_SETS    = 3;
/* Two player lengths was the brief and left a pocket you could stroll around
   in. 74 was better and still roomy; 54 is a shade over one player length, so
   the last corner is somewhere you hold rather than somewhere you wait. */
var FIN_MARGIN = 54;

/* ════════════════════ THE DRAIN CANNOT BE DONE ON THE CANVAS ════════════════════
   The first two attempts filled the dead half with `globalCompositeOperation =
   "saturation"`, which is the right blend and the wrong layer, for two reasons
   that both had to be understood before this worked:

   1. A BLEND MODE STILL ALPHA-COMPOSITES. Where the arena canvas is transparent
      - which is most of it - there is no backdrop to take the luminosity from,
      so an opaque grey source simply lands as opaque grey. The dead half was
      not being desaturated, it was being PAINTED OVER, which is why the board
      vanished and Walker became a flat grey disc.

   2. THE BOARD IS NOT ON THAT CANVAS ANYWAY. The starfield, the nebula and
      Walker himself are separate layers underneath bossFx (he is z-index 920,
      the effects canvas is 930). Nothing drawn on the canvas can reach them.

   backdrop-filter is the one thing that can: it desaturates whatever the
   compositor has already put behind the element, across every layer, without
   drawing anything of its own. So the dead half is the same board, pixel for
   pixel, with the colour taken out - which is what was asked for and what the
   canvas could never have given.

   Seven bands rather than one element, because the rip needs to tear them apart
   at different speeds. In normal sweep they share an offset and read as one
   sheet. */
var BW_SLABS = 7, BW = null;
function bwEls(){
  if (BW && BW.wrap.isConnected) return BW;
  var wrap = document.createElement("div");
  wrap.id = "finBW";
  wrap.style.cssText = "position:fixed;inset:0;z-index:935;pointer-events:none;" +
                       "overflow:hidden;display:none";
  var bands = [];
  for (var i=0;i<BW_SLABS;i++){
    var b = document.createElement("div");
    b.style.cssText = "position:absolute;left:0;top:0;transform-origin:0 0;" +
                      "backdrop-filter:grayscale(1);-webkit-backdrop-filter:grayscale(1)";
    wrap.appendChild(b); bands.push(b);
  }
  document.body.appendChild(wrap);
  BW = { wrap:wrap, bands:bands };
  return BW;
}
function bwHide(){ if (BW) BW.wrap.style.display = "none"; }
function bwPlace(f){
  var e = bwEls(), BIG = Math.hypot(VW(), VH()) * 1.7;
  var h = (BIG*2) / BW_SLABS;
  e.wrap.style.display = "block";
  for (var i=0;i<BW_SLABS;i++){
    var x0 = f.thr + (f.rip||0) * (0.55 + i*0.42);
    var y0 = -BIG + i*h;
    var b = e.bands[i];
    b.style.width  = Math.round(BIG) + "px";
    b.style.height = Math.ceil(h) + "px";
    b.style.transform = "translate(" + f.cx.toFixed(1) + "px," + f.cy.toFixed(1) + "px) " +
                        "rotate(" + f.an.toFixed(4) + "rad) " +
                        "translate(" + x0.toFixed(1) + "px," + y0.toFixed(1) + "px)";
  }
}

function finBegin(){
  /* he comes DOWN off the ceiling to do this, not up into it - see the limp
     in finStep. Starting height only; brkPost is rewritten every frame. */
  F.brkPost = { x: VW()*0.76, y: VH()*0.13 };
  /* ════════════════════ A LINE, NOT A CIRCLE ════════════════════
     The expanding ring was geometrically honest and looked like a loading
     spinner: a huge arc with no orientation, no obvious "wrong side", and a
     curve that read as decoration until it was already on top of you. A
     straight edge sweeping down the room says the one thing that matters -
     THERE IS AN ABOVE AND A BELOW, AND ABOVE IS DEATH - and it says it from the
     first frame, because a line has a side and a circle does not.

     The whole thing is one dot product. C is the corner you end up in, n is the
     unit vector from C toward the far top of the floor, and every point gets
     s = dot(pt - C, n): zero in the corner, biggest at the far top. Death is
     s > thr, and thr walks from "past the furthest corner" down to FIN_MARGIN.
     One number, and it is the same number the drawing and the kill test both
     read - which is the mistake the shower made three separate times. */
  var C = { x: P.w/2, y: VH() - P.h/2 };
  var wall = VW()*PLAY_MAX_X;
  /* ════════════════════ AIMED LOWER, SO THE POCKET IS LOW AND NOT JUST LEFT ════════════════════
     Pointing the normal at the top-right corner of the floor made the line
     steep, and a steep line leaves its last safe ground up the whole left EDGE
     rather than down in the corner - you could sit two thirds of the way up the
     side of the room and still be alive at the end. Aiming it above the top of
     the floor tips the line flatter, so the sweep comes down the room and the
     pocket it leaves is genuinely at the bottom. */
  var dx = wall - C.x, dy = (-VH()*0.42) - C.y, dL = Math.hypot(dx, dy) || 1;
  F.fin = {
    cx:C.x, cy:C.y, nx:dx/dL, ny:dy/dL,
    an:Math.atan2(dy/dL, dx/dL),
    hp0:Math.max(1, F.hpW),
    smax:dL,                 /* the far top corner of the floor */
    thr:dL, r:0, dead:0, t:0, dt:0,
    rays:[], rayAt:0
  };
  /* ════════════════════ THE BAND IS THE SCREEN, NOT THE FLOOR ════════════════════
     This was measured off the PLAY rect - x < wall - on the reasoning that the
     lines should not spawn where the player could never stand. But they are
     DRAWN edge to edge, and the screen is half as wide again as the floor, so
     every y' belonging only to the right-hand strip got no line at all. On
     screen that is a large clean band with no comb in it, sitting right across
     the middle of the arena: "there is still a gap here".

     The band is the whole viewport now. Lines outside the floor cost nothing -
     nobody can stand there to be hit by them - and the comb reads as one object
     crossing the entire room, which is the only way the one deliberate hole in
     it means anything. */
  var lo = 1e9, hi = -1e9, cs = [[0,0],[VW(),0],[0,VH()],[VW(),VH()]];
  for (var ci=0; ci<4; ci++){
    var ry = -(cs[ci][0]-C.x)*F.fin.ny + (cs[ci][1]-C.y)*F.fin.nx;
    if (ry < lo) lo = ry;
    if (ry > hi) hi = ry;
  }
  F.fin.yLo = lo; F.fin.yHi = hi;
}

function finStep(dt){
  var f = F.fin; if (!f) return;
  if (f.dead){ f.dt += dt; return; }
  /* ════════════════════ WHEN YOU ARE DEAD, SO IS THE FINALE ════════════════════
     f.t kept advancing after a death, so the cross-lines carried on arming and
     firing over the corpse and the sweep carried on eating the room. The clock
     stops and anything in flight is dropped - a half-armed hairline frozen on
     screen is no better than one that keeps going. */
  if (F.over){ if (f.rays.length) f.rays.length = 0; return; }
  f.t += dt;
  var p = Math.max(0, Math.min(1, 1 - Math.max(0, F.hpW) / f.hp0));
  f.p = p;
  f.thr = f.smax + (FIN_MARGIN - f.smax) * p;

  /* ════════════════════ AND HE LIMPS DOWN WHILE IT HAPPENS ════════════════════
     He used to plant at 0.06 of the height, which put his head off the top of
     the screen - he was not "at the top of the room", he was through the
     ceiling. He starts lower now and SINKS as he empties, with an uneven hitch:
     |sin| cubed spends most of its time near zero and then lurches, which reads
     as a limp where a plain sine reads as breathing. */
  if (F.brkPost){
    F.brkPost.y = VH()*(0.13 + 0.20*p) +
                  Math.pow(Math.abs(Math.sin(f.t*1.9)), 3) * 10 * p;
  }

  /* ════════════════════ TWO SETS, ON A CLOCK THAT STARTS WHEN THE HIDE ENDS ════════════════════
     Not while a hide is up: the wedge already asks you to be in one exact
     place, and lines through it would be asking for two things at once. */
  if ((f.hides|0) >= 2 && !F.move && f.hideEnd === undefined) f.hideEnd = f.t;
  if (f.hideEnd !== undefined && (f.sets|0) < RAY_SETS &&
      f.t >= f.hideEnd + RAY_AT[f.sets|0]){
    var si = f.sets|0;
    var sp = RAY_SPACING[si], gap = RAY_GAP_AT[si], ys = [];
    /* a comb across the whole band. Walking the grid from a rounded start
       rather than from yLo keeps every set on its own regular lattice. */
    for (var gy = Math.ceil(f.yLo/sp)*sp; gy <= f.yHi; gy += sp) ys.push(gy);
    ys.sort(function(u,v){ return u - v; });   /* top of the screen first */
    /* ONE LINE OUT, NOT A BAND. The route is the hole left by dropping the
       single line nearest the stated offset, so it is exactly 2 x spacing wide
       and shrinks with the comb - deterministic, and the same on every run. */
    var best = 0;
    for (var bi=1; bi<ys.length; bi++)
      if (Math.abs(ys[bi]-gap) < Math.abs(ys[best]-gap)) best = bi;
    ys.splice(best, 1);
    for (var yi=0; yi<ys.length; yi++){
      f.rays.push({ y:ys[yi], t0: f.t*1000 + yi*RAY_STAGGER[si],
                    arm: RAY_ARM[si],
                    hue: ys.length > 1 ? (yi/(ys.length-1))*290 : 0 });
    }
    f.sets = si + 1;
  }
  for (var ri=f.rays.length-1; ri>=0; ri--){
    if (f.t*1000 - f.rays[ri].t0 > f.rays[ri].arm + RAY_FIRE) f.rays.splice(ri,1);
  }

  if (F.over || !P.live) return;
  var m = pC();
  /* the pulse bites for RAY_FIRE and only then. It reaches across the WHOLE
     screen now, both sides of the barrier - past thr you are already dead, so
     the test does not bother excluding it. */
  var rdx = m.x - f.cx, rdy = m.y - f.cy;
  var rpy = -rdx*f.ny + rdy*f.nx;
  for (var rj=0; rj<f.rays.length; rj++){
    var r2 = f.rays[rj], age = f.t*1000 - r2.t0;
    if (age < r2.arm || age > r2.arm + RAY_FIRE) continue;
    if (Math.abs(rpy - r2.y) < RAY_H + P.r){
      hurtPlayer(F.hpMmax*SHOT_FRAC, "cross-lines");
      break;
    }
  }
  /* ABOVE THE LINE IS SWEPT. raw:true so it goes through i-frames - this one is
     not a hit you can trade, and a mine cannot stop it because useBomb only
     removes entries from `shots` and the line is not one. */
  if ((m.x - f.cx)*f.nx + (m.y - f.cy)*f.ny > f.thr)
    hurtPlayer(F.hpMmax * 99, "the wall", true);
}

/* ════════════════════ THE EMP, AND HE GOES DOWN ════════════════════ */
function finCollapse(){
  var f = F.fin;
  if (f){ f.dead = 1; f.dt = 0; f.r = 0; }
  shots.length = 0;                        /* every projectile vanishes */
  /* ════════════════════ EXTREMELY VIOLENT, ON PURPOSE ════════════════════
     Three rings rather than one, thrown at different speeds so the front has
     depth instead of being a single expanding circle, and the debris is fired
     at a spread of speeds so it keeps arriving instead of leaving all at once.
     This is the blast that tears the monochrome off the room - see finDraw. */
  var far = Math.hypot(VW(), VH());
  shocks.push({ x:W.x, y:W.y, t:0, ms: 620, r: far*1.25 });
  shocks.push({ x:W.x, y:W.y, t:0, ms:1050, r: far*0.85 });
  shocks.push({ x:W.x, y:W.y, t:0, ms:1700, r: far*0.45 });
  burst(W.x, W.y, 520, 2100);
  burst(W.x, W.y, 260,  900);
  kick(4.2, 1.5, "245,250,255");
  W.spin = 0;                              /* the wheel stops dead */
  F.move = null; F.station = null;
  P.vx = 0; P.vy = 0; clearKeys();
  F.over = "player";                       /* the WALKER DOWN screen, at last */
  statsEnd(true);
  SFX.whimper();
}

function finDraw(c){
  var f = F.fin; if (!f) return;
  var BIG = Math.hypot(VW(), VH()) * 1.7;
  /* ════════════════════ THE SHEET IS RIPPED OFF, IT DOES NOT FADE ════════════════════
     After the EMP the monochrome is torn away in slabs that fly outward at
     different speeds, so colour floods back in widening stripes rather than
     cross-fading. Accelerating, because the whole point is violence: about
     350px in the first third of a second and 2400 by the first. Once the
     nearest slab has cleared the room there is nothing left to draw. */
  if (f.dead){
    f.rip = 2400 * Math.pow(Math.max(0, f.dt), 1.6);
    if (f.thr + f.rip*0.55 > BIG){ bwHide(); return; }
  }

  c.save();
  /* WORK IN THE LINE'S OWN FRAME. Translate to the corner and rotate so n is
     +x, and the sweep becomes the vertical line x = thr with the dead half
     simply being x > thr. Every rectangle below is axis-aligned in this frame,
     which is why none of this needs a polygon. */
  c.translate(f.cx, f.cy);
  c.rotate(f.an);

  /* ════════════════════ THE DRAIN IS NOT PAINTED HERE ════════════════════
     Two earlier cuts tried to do it on this canvas with a `saturation` fill
     and both were wrong for the same two reasons: a blend mode still
     alpha-composites, so over transparent canvas an opaque grey lands as
     opaque grey rather than draining anything; and the board is not on this
     canvas anyway - the starfield and Walker himself are separate layers
     underneath it. bwPlace drives DOM bands with backdrop-filter, which is the
     only thing that reaches what the compositor has already stacked up. */
  bwPlace(f);

  /* ════════════════════ WHITE WHILE IT ARMS, RAINBOW WHEN IT FIRES ════════════════════
     Orange for both made the whole set one colour and read as a warning that
     never resolved. White is the arming state and nothing else in the arena is
     a white hairline; the pulse is the payoff, and its hue is the line's place
     in the set - red at the top through violet at the bottom - so a glance at
     the colour tells you how far down the cascade has got.

     Drawn edge to edge rather than stopping at the barrier. The half above it
     is greyed by the drain like everything else up there, which is correct: the
     line exists across the whole room, and above the barrier the room is dead. */
  if (!f.dead){
    for (var qi=0; qi<f.rays.length; qi++){
      var q = f.rays[qi], age = f.t*1000 - q.t0;
      if (age < 0) continue;
      var X0 = -BIG, X1 = BIG;
      if (age < q.arm){
        var w = age / q.arm;
        c.strokeStyle = "rgba(255,255,255," + (0.12 + 0.50*w*w).toFixed(3) + ")";
        c.lineWidth = 0.8 + 0.8*w;
        c.beginPath(); c.moveTo(X0, q.y); c.lineTo(X1, q.y); c.stroke();
      } else {
        var fw = 1 - (age - q.arm)/RAY_FIRE;
        if (fw <= 0) continue;
        var col = "hsl(" + q.hue.toFixed(0) + ",100%,";
        c.save();
        c.globalCompositeOperation = "lighter";
        c.strokeStyle = col + "58%," + (0.30*fw).toFixed(3) + ")";
        c.strokeStyle = "hsla(" + q.hue.toFixed(0) + ",100%,58%," + (0.30*fw).toFixed(3) + ")";
        c.lineWidth = 16;
        c.beginPath(); c.moveTo(X0, q.y); c.lineTo(X1, q.y); c.stroke();
        c.strokeStyle = "hsla(" + q.hue.toFixed(0) + ",100%,66%," + (0.95*fw).toFixed(3) + ")";
        c.lineWidth = 4.2;
        c.beginPath(); c.moveTo(X0, q.y); c.lineTo(X1, q.y); c.stroke();
        c.strokeStyle = "rgba(255,255,255," + (0.95*fw).toFixed(3) + ")";
        c.lineWidth = 1.5;
        c.beginPath(); c.moveTo(X0, q.y); c.lineTo(X1, q.y); c.stroke();
        c.restore();
      }
    }
  }


  /* ════════════════════ THE EDGE ITSELF, IN EVERY COLOUR THE DEAD HALF NO LONGER HAS ════════════════════
     A rainbow is the loudest thing available and it is the right call exactly
     once: it is the only saturated object left on that side of the screen, so
     it cannot be mistaken for a bullet, a tile or him. It also drifts, so the
     line is never a static piece of furniture. */
  /* THE GRADIENT HAS TO FIT ON THE SCREEN. Run across +/-BIG it put barely a
     sixth of one hue in view, so the "rainbow" arrived as a single flat colour
     that happened to change slowly - which is a worse tell than one deliberate
     colour would have been. Sized to the viewport it reads as a spectrum, which
     is the point: nothing else on that side of the line has any colour left. */
  if (f.dead) { c.restore(); return; }   /* the line dies with him */
  var SPAN = Math.max(VW(), VH()) * 0.60;
  var rg = c.createLinearGradient(0, -SPAN, 0, SPAN);
  var roll = (F.t*0.00022) % 1;
  for (var g=0; g<=6; g++)
    rg.addColorStop(g/6, "hsl(" + (((roll + g/6) % 1)*360).toFixed(0) + ",100%,62%)");

  /* THE COLOUR HAS TO SURVIVE ITS OWN GLOW. A 26px additive bloom and a 2.2px
     white core between them washed the spectrum to lavender - the gradient was
     correct and simply could not be seen through the light on top of it. The
     bloom is dimmer and the core is thinner and no longer pure white, so what
     you read is the colour rather than the halo. */
  /* ════════════════════ THE COLOUR SITS ON THE LIVING SIDE OF THE LINE ════════════════════
     The drain is a DOM layer ABOVE this canvas, so anything drawn at or past
     thr is greyed along with everything else - the rainbow was being eaten by
     the very effect it is meant to mark the edge of. The body is drawn just
     inside the live half so it keeps its colour, with its outer edge landing
     exactly on thr, and a white hairline sits ON thr as the precise boundary.
     What you see is what kills you, to the pixel, and it is the only saturated
     thing left anywhere near that edge. */
  var LX = f.thr - 5.5;
  c.globalCompositeOperation = "lighter";
  c.strokeStyle = rg; c.lineWidth = 30; c.globalAlpha = 0.13;
  c.beginPath(); c.moveTo(LX, -BIG); c.lineTo(LX, BIG); c.stroke();
  c.globalAlpha = 1;
  c.strokeStyle = rg; c.lineWidth = 11;
  c.beginPath(); c.moveTo(LX, -BIG); c.lineTo(LX, BIG); c.stroke();
  c.globalCompositeOperation = "source-over";
  c.strokeStyle = "rgba(255,255,255,.85)"; c.lineWidth = 1.6;
  c.beginPath(); c.moveTo(f.thr, -BIG); c.lineTo(f.thr, BIG); c.stroke();

  /* NO TICK MARKS. They were there to give the line a facing in a still frame,
     and in motion they did nothing the rainbow and the drain were not already
     saying - the colour is on the living side and the grey is on the dead one,
     which is the facing. They only added clutter to the one edge that has to
     stay unambiguous. */
  c.restore();
}
function walkerR(){ return (WALK/2)*W.scale; }
/* {B} WHERE HIS SHELL ACTUALLY ENDS {B}
   Measured off the alpha of walker_ring.png rather than guessed: the art is
   opaque out to 0.995 of its half-width and visible to 1.007, and it is drawn
   across exactly WALK pixels - so walkerR() IS the outer edge of the knotwork
   and anything below it is drawing on top of him. Everything that is supposed
   to LEAVE him starts here instead. */
function wedgeR(){ return walkerR()*1.03; }

/* ── sound, on the game's context ──────────────────────────────────────── */
function ac(){ return (typeof audio === "function") ? audio() : null; }
function muted(){ return (typeof S === "object" && S) ? !!S.muted : false; }
function knock(f0,f1,dur,peak){
  if (muted()) return;
  if (typeof thud === "function") thud(f0,f1,dur,peak);
}
function shaper(a0){
  var a = ac(); if (!a) return null;
  var c = a.createWaveShaper(), n = 1024, cv = new Float32Array(n);
  for (var i=0;i<n;i++){ var x = i*2/n-1; cv[i] = (1+a0)*x/(1+a0*Math.abs(x)); }
  c.curve = cv; c.oversample = "4x"; return c;
}
/* HE GOES DEMONIC IN THE BROWSER, because there is no demonic take — the voice
   tool only returns the polite read. Both layers are pitched to the SAME rate
   and only one is shaped: a clean copy at the original rate under a slowed one
   drifts apart within a word and the line turns to mush. */
var DEMON_RATE = 0.80;
function voicePlay(name, demonic){
  var a = ac(); if (!a || muted() || !BUF[name]) return;
  if (a.state === "suspended") a.resume();
  var when = a.currentTime + 0.02, buf = BUF[name];
  function src(rate, gain){
    var s = a.createBufferSource(), g = a.createGain();
    s.buffer = buf; s.playbackRate.value = rate; g.gain.value = gain;
    s.connect(g); voices.push(s); return { s:s, g:g };
  }
  if (!demonic){
    var p = src(1, 0.95); p.g.connect(a.destination); p.s.start(when); return;
  }
  var out = a.createGain(); out.gain.value = 1; out.connect(a.destination);
  var wet = src(DEMON_RATE, 0.55), sh = shaper(9);
  var lp = a.createBiquadFilter(); lp.type="lowpass"; lp.frequency.value=5200;
  wet.s.disconnect && 0; wet.g.disconnect();
  wet.s.connect(sh); sh.connect(lp); lp.connect(wet.g); wet.g.connect(out);
  var dry = src(DEMON_RATE, 0.85); dry.g.connect(out);
  var sub = src(DEMON_RATE*0.988, 0.30); sub.g.connect(out);
  wet.s.start(when); dry.s.start(when); sub.s.start(when+0.018);
}
function voiceStop(){
  voices.forEach(function(v){ try{ v.stop(); }catch(e){} });
  voices = [];
}
/* P HAS NO RECORDING, so his one line is still synthesised. Walker's are not
   — the blips are the understudy and the understudy does not go on when the
   actor is there. */
function blip(ch){
  var a = ac(); if (!a || muted()) return;
  var f = 300 * Math.pow(2, (ch.charCodeAt(0)%12)/24);
  var o = a.createOscillator(), g = a.createGain(), t = a.currentTime;
  o.type = "square";
  o.frequency.setValueAtTime(f, t);
  o.frequency.exponentialRampToValueAtTime(f*1.12, t+0.055);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.075, t+0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t+0.055);
  o.connect(g); g.connect(a.destination); o.start(t); o.stop(t+0.08);
}

/* ── the starfield ─────────────────────────────────────────────────────── */
/* THE ARENA IS SPACE AND IT HAD NOTHING IN IT. The mockup drifted 160 stars
   behind the fight; the port dropped them, and what was left was a dark
   gradient — which reads as a dimmed web page rather than as somewhere the
   fight is happening.

   IT CANNOT REUSE #starFx. That canvas is z-index -1, behind the whole page and
   therefore behind the veil that darkens it, and it belongs to the game's own
   shooting stars and shockwave rings. This is its own layer, sitting between
   the veil and the board. */
/* ════════════════════ EVERY SOUND IN THE FIGHT IS SYNTHESISED ════════════════════
   There are no sample files here and there should not be. The game already
   builds its cues out of oscillators - thud(), ping(), blip() - the context is
   open and already gated behind S.muted, and a boss fight needs its cues TUNED
   far more often than it needs them recorded. Every one of these is a handful
   of numbers, so "the beam is too shrill" is a one-line change rather than a
   re-render and a download.

   Two primitives cover all of it: a pitched tone with an envelope, and a
   band-passed noise burst. Everything routes through one master gain so the
   whole fight can be balanced in one place.

   THE RULE THAT KEEPS IT FROM BECOMING NOISE: a cue exists only where it tells
   you something you cannot already see, or confirms something you must not
   miss. Four hundred bullets do not each get a sound. */
var SFX_GAIN = null, SFX_VOL = 0.34;
function sfxBus(){
  var a = ac(); if (!a) return null;
  if (!SFX_GAIN || SFX_GAIN.context !== a){
    SFX_GAIN = a.createGain();
    SFX_GAIN.gain.value = SFX_VOL * MASTER;
    SFX_GAIN.connect(a.destination);
  }
  return SFX_GAIN;
}
function sfxTone(type, f0, f1, dur, peak, delay){
  var a = ac(), bus = sfxBus(); if (!a || !bus || muted()) return;
  var t = a.currentTime + (delay||0);
  var o = a.createOscillator(), g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(Math.max(20,f0), t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20,f1), t+dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002,peak), t+Math.min(0.03,dur*0.2));
  g.gain.exponentialRampToValueAtTime(0.0001, t+dur);
  o.connect(g); g.connect(bus); o.start(t); o.stop(t+dur+0.02);
}
function sfxNoise(dur, peak, f0, f1, q, delay){
  var a = ac(), bus = sfxBus(); if (!a || !bus || muted()) return;
  var t = a.currentTime + (delay||0);
  var n = Math.max(1, Math.floor(a.sampleRate*Math.min(dur,3)));
  var buf = a.createBuffer(1, n, a.sampleRate), ch = buf.getChannelData(0);
  for (var i=0;i<n;i++) ch[i] = Math.random()*2-1;
  var src = a.createBufferSource(); src.buffer = buf;
  var bp = a.createBiquadFilter();
  bp.type = "bandpass"; bp.Q.value = q||1.2;
  bp.frequency.setValueAtTime(Math.max(40,f0), t);
  bp.frequency.exponentialRampToValueAtTime(Math.max(40,f1), t+dur);
  var g = a.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002,peak), t+Math.min(0.02,dur*0.15));
  g.gain.exponentialRampToValueAtTime(0.0001, t+dur);
  src.connect(bp); bp.connect(g); g.connect(bus);
  src.start(t); src.stop(t+dur+0.02);
}

/* Named for the EVENT, not the sound, so re-tuning one never means hunting for
   its call site. Both wind-ups RISE, because a rising pitch is the only thing
   an ear reads as "not yet, not yet, NOW" without being taught it. */
/* ════════════════════ TWO CUES, AND ONLY TWO ════════════════════
   The first cut of this had fourteen: a rise on every wind-up, a burst on every
   fire, a tick per second of tile charge, a beat under the shield being down.
   Every one defensible on its own; together they were a synthesised layer
   running more or less continuously under a soundtrack that was mastered
   without them, and the honest verdict on hearing it was that the fight sounded
   worse than it did in silence.

   What survives is what the MUSIC cannot tell you and the screen might not: you
   took a hit, and you died. Both are transients, both are things you need to
   know at the instant they happen, and neither competes with anything - the
   moves already announce themselves with 1.8 to 2.6 seconds of telegraph on
   screen, which is a better warning than a noise.

   The two primitives above stay. Adding a cue back is one line here and one at
   its call site; the reason to be sparing is written down so the next person
   has to argue with it rather than rediscover it. */
var SFX = {
  hit:   function(){ sfxNoise(0.16,0.28,1800,220,1.0);
                     sfxTone("square",320,80,0.14,0.14); },
  /* ════════════════════ WHIMPERING, NOT MOANING ════════════════════
     A moan is one long low note. A whimper is several SHORT ones, higher, each
     bending down as it dies, each quieter than the last, with uneven gaps so it
     does not read as a rhythm. Five of them over a second, thinning out. */
  whimper: function(){
    var at = [0, 0.25, 0.46, 0.74, 1.05], f0 = [530, 480, 430, 385, 340];
    for (var i=0;i<at.length;i++){
      var fade = 1 - i*0.15;
      sfxTone("sawtooth", f0[i], f0[i]*0.60, 0.22, 0.085*fade, at[i]);
      sfxNoise(0.17, 0.032*fade, 950, 320, 0.7, at[i]);
    }
  },
  death: function(){ sfxTone("sawtooth",300,30,0.75,0.20);
                     sfxNoise(0.60,0.12,700,70,0.5); },
  /* ════════════════════ THE ONE CUE THAT IS A REWARD ════════════════════
     Everything else here warns you. This one pays you, so it is the opposite
     shape: a rising major arpeggio, bright and clean, the sound a pickup makes
     in every game that has ever had one. Three short tones rather than a
     sustained chord - it lands and gets out of the way like the other two. */
  loot:  function(){ sfxTone("square", 784,  784, 0.09, 0.10);
                     sfxTone("square", 988,  988, 0.09, 0.09, 0.075);
                     sfxTone("square",1319, 1319, 0.16, 0.10, 0.150);
                     sfxTone("triangle",1568,1568,0.22, 0.05, 0.150); }
};

var stars = [], starWarp = 0.15;
function makeStars(){
  stars = [];
  for (var i=0;i<190;i++) stars.push({
    x:Math.random(), y:Math.random(), z:0.25+Math.random()*0.75,
    r:0.4+Math.random()*1.5
  });
}
/* THE SKY IS NOT EMPTY. Stars on black is a starfield; what makes a picture
   read as DEEP space is the dust between them. Six huge soft blobs, fixed at
   the start of the fight, at alphas low enough that they never compete with a
   bullet — they exist to stop the background being a flat void, and a flat void
   is what made everything drawn on top of it look like stickers. */
/* ═══════════ THE SKY IS EARNED, NOT GIVEN ═════════════════════════════════
   At the first board it is BLACK — flat, empty, nothing out there but the two
   of you. Every square you unlock puts something in it: the stars come up, then
   the dust, then the colour, until a maxed board fights him inside a nebula.

   It costs nothing and it is the only thing in the fight that says anything
   about the ENTIRE GAME rather than about this one encounter. A player who
   comes back at forty tiles is fighting in a different universe from the one
   they first walked into, and nobody has to explain why.

   Anchored to the BOARD rather than to progress within the fight, deliberately:
   the sky is who you are when you arrive, not what you have done since. */
var nebula = [], skyDepth = 0;
function makeNebula(){
  nebula = [];
  var tiles = 4;
  try { if (typeof BOARD === "object" && BOARD.tiles) tiles = BOARD.tiles; } catch(e){}
  /* 4 tiles -> 0, 40 -> 1, on a curve that stays near nothing for the first few
     so the opening fight really is black rather than nearly black */
  skyDepth = Math.pow(Math.max(0, Math.min(1, (tiles-4)/36)), 1.35);
  var C = [[104,64,190],[52,74,178],[150,54,140],[38,96,168],[92,48,160],[64,40,140]];
  var n = Math.round(skyDepth*6);
  for (var i=0;i<n;i++){
    nebula.push({ x:(0.12+((i*0.6180339887)%1)*0.80), y:(0.10+((i*0.3819)%1)*0.80),
                  r:0.30+((i*0.7549)%1)*0.34, c:C[i] });
  }
}
function drawStars(){
  var cv = $("bossSky"); if (!cv) return;
  var dp=DPR(), bw=Math.round(VW()*dp), bh=Math.round(VH()*dp);
  if (cv.width!==bw||cv.height!==bh){ cv.width=bw; cv.height=bh; }
  var c = cv.getContext("2d"), SW = VW(), SH = VH();
  /* the backing store is in device pixels; everything below is written in CSS
     pixels, so the transform does the conversion once and nothing else changes */
  c.setTransform(1,0,0,1,0,0);
  c.clearRect(0,0,cv.width,cv.height);
  c.setTransform(dp,0,0,dp,0,0);
  for (var n=0;n<nebula.length;n++){
    var nb=nebula[n], nx=nb.x*SW, ny=nb.y*SH, nr=nb.r*Math.max(SW,SH);
    var ng=c.createRadialGradient(nx,ny,0,nx,ny,nr);
    ng.addColorStop(0,"rgba("+nb.c[0]+","+nb.c[1]+","+nb.c[2]+","+(0.17*skyDepth).toFixed(3)+")");
    ng.addColorStop(0.55,"rgba("+nb.c[0]+","+nb.c[1]+","+nb.c[2]+","+(0.07*skyDepth).toFixed(3)+")");
    ng.addColorStop(1,"rgba("+nb.c[0]+","+nb.c[1]+","+nb.c[2]+",0)");
    c.fillStyle=ng; c.beginPath(); c.arc(nx,ny,nr,0,6.28318); c.fill();
  }
  for (var i=0;i<stars.length;i++){
    var st = stars[i];
    st.y += (0.0004 + 0.010*starWarp) * st.z;
    if (st.y > 1){ st.y -= 1; st.x = Math.random(); }
    /* the stars are earned too — a black sky with a full starfield in it is not
       empty, it is merely unlit */
    c.fillStyle = "rgba(200,190,255," +
      ((0.045 + 0.46*skyDepth) * (0.3 + st.z*0.7)).toFixed(3) + ")";
    c.fillRect(st.x*SW, st.y*SH, st.r, st.r*(1 + starWarp*18*st.z));
  }
}

/* ── sparks ────────────────────────────────────────────────────────────── */
var sparks = [], shards = [];
/* THE CAP WAS THE CEILING ON THE WHOLE ATTACK. 900 particles spread across a
   1280x820 arena is roughly one per eleven hundred square pixels — geometric
   coverage of 78%, and visually a drizzle. The AOE is supposed to be a wall of
   fire with one door in it, so the budget goes up by a factor of four and the
   emission rate with it. Canvas draws lines faster than anyone expects; the
   real cost here is fill rate, not count. */
/* A HAILSTORM, WHICH MEANS THE CAP IS THE PICTURE. Culling at the arena edge
   already means every particle in the budget is one you can see, so the budget
   IS the density — 3600 across 1280x820 is one per three hundred square pixels,
   which is a heavy shower and not a wall. Ten thousand is the whole screen
   white-hot except the door.

   It is affordable because of what these are: a stroked line each, no gradients,
   no shadows, no per-particle state beyond six numbers. Fill rate is the cost,
   and a 34px hairline costs almost none of it. */
var SPARK_G = 620, SPARK_DRAG = 0.86, SPARK_MAX = 10000;
var SPARK_BINS = null;

/* ══════ ADAPT THE RESOLUTION, NEVER THE NUMBER OF SPARKS ═══════════════════
   I had this spend fewer SPARKS when the frame rate dropped, and that was
   wrong. The shower's density is not decoration — it is the attack telling you
   there is nowhere to stand. Thin it out and the screen stops looking covered,
   which reads exactly as "I can run away from this", and a player on a slower
   machine gets a different and easier-looking fight. That is the thing this
   whole file has spent the day removing.

   Measured at full density the shower touches 100% of the screen. It has to
   keep doing that on every machine, so the spark count is now fixed for
   everybody and the SAME storm is drawn at a lower resolution instead when a
   machine cannot hold the frame rate. Fewer pixels, never fewer sparks: the
   picture stays honest and only gets softer. */
var QUALITY = 1, qAcc = 0, qFrames = 0;
function qualityStep(dt){
  qAcc += dt; qFrames++;
  if (qAcc < 0.5) return;
  var fps = qFrames/qAcc;
  if (fps < 50)      QUALITY = Math.max(0.25, QUALITY - 0.15);
  else if (fps > 58) QUALITY = Math.min(1,    QUALITY + 0.08);
  qAcc = 0; qFrames = 0;
}
/* ════════════════ THE SHOWER IS COSMIC, NOT A GRINDER ═════════════════════
   The old ramp was white -> orange -> red -> black, which is the colour of hot
   steel and exactly right for a welding spark. It is exactly wrong for this:
   the arena is deep space with a starfield behind it, and a screen full of
   orange sparks over black read as an eighties arcade cabinet rather than as
   something happening in the sky.

   The new ramp keeps a white-hot core and an orange shoulder — the eye needs
   the hottest part to look hot — and then falls through VIOLET into DEEP BLUE
   instead of into red. So the leading edge is fire and the body of the storm is
   nebula, which is the same object the background is made of.

   ORANGE STAYS BECAUSE THE PURPLE NEEDS IT. A purely blue-violet storm over a
   blue-violet starfield disappears; the orange shoulder is what separates the
   thing that kills you from the scenery behind it. */
var HEAT = [
  [1.00, 255, 246, 232],   /* white-hot, the instant it leaves him */
  [0.74, 255, 176,  84],   /* the orange shoulder — the only warm band */
  [0.46, 196, 122, 255],   /* violet */
  [0.22,  96,  96, 240],   /* blue */
  [0.00,  26,  20,  86]    /* deep indigo, gone against the sky */
];
function heatRGB0(h){
  for (var i=0;i<HEAT.length-1;i++){
    var a=HEAT[i], b=HEAT[i+1];
    if (h<=a[0] && h>=b[0]){
      var t=(h-b[0])/(a[0]-b[0]);
      return [b[1]+(a[1]-b[1])*t|0, b[2]+(a[2]-b[2])*t|0, b[3]+(a[3]-b[3])*t|0];
    }
  }
  return [122,24,0];
}
/* THE HEAT RAMP IS THE WHOLE SPARK SYSTEM - the shower, the welding spray, the
   rune charge, every burst - so the phase colour goes on here once rather than
   at forty call sites. sparkDraw() buckets by heat before it calls this, so it
   runs about forty times a frame, not ten thousand. */
function heatRGB(h){
  var c = heatRGB0(h), d = whue(), gl = wglitch();
  if (!d && gl < 0.01) return c;
  return hueShift(c[0], c[1], c[2], d, 1 + 0.45*gl, 1 - 0.22*gl);
}
/* `g` IS A PER-SPARK GRAVITY SCALE, and the AOE needs it. A welding spark wants
   to arc and fall — that is what makes it read as hot metal rather than as a
   laser. But the AOE has to CROSS THE ARENA, and at full gravity a particle
   travelling twelve hundred pixels has fallen off the bottom of the screen long
   before it gets there. The shower rides at a fraction of it. */
/* `k` IS A PER-SPARK COOLING RATE, and it is what stops the storm looking like
   one material. With every particle running the same ramp at the same speed the
   whole field changes colour together, which is the flat "sprite sheet" look —
   varying how fast each one falls through the ramp means at any instant the
   screen has white, orange, violet and blue in it at once, which is what a
   nebula actually looks like. */
function addSpark(x,y,vx,vy,ttl,heat,g,d){
  if (sparks.length >= SPARK_MAX) return;   /* NOT scaled — see the note on QUALITY */
  sparks.push({x:x,y:y,vx:vx,vy:vy,t:0,ttl:ttl,
               h0:(heat===undefined?1:heat), g:(g===undefined?1:g),
               d:(d===undefined?1:d),
               k:1.35+Math.random()*1.5, forked:false});
}
function burst(x,y,n,speed){
  for (var i=0;i<n;i++){
    var a=Math.random()*6.28318, v=speed*(0.25+Math.random()*0.95);
    addSpark(x,y,Math.cos(a)*v,Math.sin(a)*v-speed*0.25,0.3+Math.random()*0.7,0.9+Math.random()*0.1);
  }
}
function sparkStep(dt){
  var drag = Math.pow(SPARK_DRAG, dt);
  for (var i=sparks.length-1;i>=0;i--){
    var s=sparks[i]; s.t += dt;
    if (s.t >= s.ttl){ sparks.splice(i,1); continue; }
    /* PER-SPARK DRAG, AND IT WAS THE CEILING ALL ALONG. Welding sparks want the
       full 0.86 — they slow, they arc, they die near the wheel, which is what a
       grinder does. The shower wants almost none, because it is thrown INTO
       SPACE and space does not slow anything down.

       Under full drag a particle can never cover more than v0/0.1508 however
       long it lives, so the slow half of the shower could not reach the far wall
       of a 1900px arena at any lifetime. Raising the SPEED did nothing, raising
       the LIFETIME did nothing, because neither was the limit. Drag was. */
    var dg = (s.d===1) ? drag : Math.pow(SPARK_DRAG*s.d, dt);
    s.vy += SPARK_G*s.g*dt; s.vx*=dg; s.vy*=dg;
    s.x += s.vx*dt; s.y += s.vy*dt;
    /* CULL WHAT HAS LEFT THE ARENA, AND THIS IS WHY THE WALL LOOKED THIN. The
       budget is a fixed number of particles; the AOE throws them at up to
       1700px/s and lets them live over two seconds, so within half a second
       most of the cap was particles two screens away that nobody would ever
       see. Raising the cap did nothing because the cap was not the constraint —
       the waste was. Dropping them at the edge spends the entire budget on
       pixels the player is looking at. They travel outward and gravity is a
       twelfth here, so nothing culled was coming back. */
    if (s.x < -150 || s.x > VW()+150 || s.y < -150 || s.y > VH()+150){
      sparks.splice(i,1); continue;
    }
    /* the fork is what says "welding" — once each, or it turns into fog */
    /* the fork is what says "welding" — but it also DOUBLES the population,
       and at three thousand sparks that is what turns a shower into confetti.
       Only the hot ones fork, and less often. */
    if (!s.forked && s.h0 > 0.93 && s.t > s.ttl*0.45 && Math.random() < 1.1*dt){
      s.forked = true;
      for (var f=0;f<3;f++){
        var fa=Math.random()*6.28318, fv=40+Math.random()*90;
        addSpark(s.x,s.y,s.vx*0.35+Math.cos(fa)*fv,s.vy*0.35+Math.sin(fa)*fv,
                 0.14+Math.random()*0.2,1,s.g);
      }
    }
  }
}
/* THE STREAK IS A FIXED SLICE OF TIME, CLAMPED — not the distance covered since
   the last frame, which ties the look of a spark to the frame rate. */
function sparkDraw(c){
  var n = sparks.length; if (!n) return;

  /* ═══════ ONE PATH PER BUCKET, NOT ONE PER SPARK ═════════════════════════
     This drew every spark with its own beginPath/moveTo/lineTo/stroke, so a
     full shower was up to TEN THOUSAND separate draw calls a frame. On the
     machine it was written on that survives; on anything slower it does not,
     and the attack that fills the screen is exactly when the frame budget is
     already gone. It is the single most expensive thing in the fight.

     A spark's whole appearance is two numbers: `heat` decides the colour and
     `f` (how much life is left) decides the alpha and the width. So the sparks
     are bucketed by those two, and each bucket is stroked as ONE path holding
     hundreds of segments. Forty draw calls instead of ten thousand, and the
     picture is the same to within one bucket of colour.

     The bins are allocated once and emptied by setting length = 0, because
     allocating forty arrays a frame during a bullet hell is asking the garbage
     collector for a pause at the worst possible moment. */
  var HB=10, FB=4, NB=HB*FB, i, b;
  if (!SPARK_BINS){ SPARK_BINS=new Array(NB); for(i=0;i<NB;i++) SPARK_BINS[i]=[]; }
  for (i=0;i<NB;i++) SPARK_BINS[i].length=0;

  for (i=0;i<n;i++){
    var s=sparks[i], f=1-s.t/s.ttl;
    if (f<0) f=0; else if (f>1) f=1;
    var heat = s.h0*Math.pow(f, s.k||2);
    var hi = (heat*HB)|0; if (hi>=HB) hi=HB-1; else if (hi<0) hi=0;
    var fi = (f*FB)|0;    if (fi>=FB) fi=FB-1;
    SPARK_BINS[hi*FB+fi].push(s);
  }

  for (b=0;b<NB;b++){
    var arr=SPARK_BINS[b], m=arr.length; if (!m) continue;
    var hMid = (((b/FB)|0)+0.5)/HB, fMid = ((b%FB)+0.5)/FB;
    var col = heatRGB(hMid);
    c.strokeStyle="rgba("+col[0]+","+col[1]+","+col[2]+","+(0.42+0.5*fMid).toFixed(3)+")";
    c.lineWidth = Math.max(0.75, 2.3*fMid);
    c.beginPath();
    for (var j=0;j<m;j++){
      var t=arr[j], v=Math.hypot(t.vx,t.vy)||1, L=Math.min(78, v*0.086);
      c.moveTo(t.x - t.vx/v*L, t.y - t.vy/v*L); c.lineTo(t.x, t.y);
    }
    c.stroke();
  }

  /* the hottest tenth get a head, and they are one path too */
  c.fillStyle="rgba(255,248,236,0.55)";
  c.beginPath();
  var any=false;
  for (i=0;i<n;i++){
    var s2=sparks[i], f2=1-s2.t/s2.ttl;
    if (f2>0.9){ c.moveTo(s2.x+1.7, s2.y); c.arc(s2.x,s2.y,1.7,0,6.28318); any=true; }
  }
  if (any) c.fill();
}

/* ── the fight ─────────────────────────────────────────────────────────── */
var SEGS = 5, SEG = 6.28318/SEGS;
/* ══════════ RADIANS PER SECOND. EVERYTHING HERE USED TO BE PER FRAME ═══════
   `W.ang += W.spin` had no dt in it, so every rotation in the fight was
   measured in radians per FRAME. On the 60Hz machine it was written on that is
   the intended speed; on a 144Hz monitor he span 2.4 times faster, and on
   anything dropping to 30fps he span half as fast. Not a rendering difference —
   the ring's angle IS the AOE's safe corridor, so the attack itself arrived at
   a different speed for every player, and the ones with good monitors got the
   hardest version of the fight.

   Every spin constant below is now rad/SECOND and the integration multiplies by
   dt, so the fight is the same fight at any refresh rate. The numbers are the
   old per-frame values times 60. */
var IDLE_SPIN = 1.20;       /* rad/s — his resting turn */

/* ════════════════════ HE DESCENDS THE RAINBOW AND THEN STOPS BEING A COLOUR ════════════════════
   One hue per tile taken, walked in spectrum order, and a `glitch` that rises
   with it: saturation pushed past where the art was authored and the whole
   thing pulled darker and harder, so the last break is deep violet with the
   knotwork reading as corrupted rather than lit.

     esc 0     0deg   his own red, exactly as drawn
     esc 1    48deg   amber
     esc 2   118deg   green
     esc 3   196deg   cyan-blue
     esc 4   272deg   violet, glitch at full

   THE BULLETS ARE DELIBERATELY NOT IN THIS. Their colours are a language the
   player is asked to learn - "the magenta ones come in a ring" - and rotating
   them every phase would take that away at exactly the point the screen is
   busiest. What shifts is HIM and what leaves him: his art, his sparks, his
   telegraphs. What comes at you keeps its name. */
/* his own hot red, and the base every marking that belongs to HIM is drawn
   from - it goes through hx() like his art does, so it tracks the phase */
var WALK_COL = "255,96,70";
var PHASE_HUE    = [0, 48, 118, 196, 272];
var PHASE_GLITCH = [0, 0.12, 0.30, 0.55, 1.00];
/* the shield coming off throws the hue forward and it falls back - the pulse
   gets a colour of its own without needing a whole new effect */
var pulseHue = 0;
function whue(){
  var i = Math.min(PHASE_HUE.length-1, Math.max(0, esc()));
  return PHASE_HUE[i] + pulseHue;
}
function wglitch(){
  var i = Math.min(PHASE_GLITCH.length-1, Math.max(0, esc()));
  return Math.min(1.5, PHASE_GLITCH[i] + pulseHue/140);
}

/* HSL round trip, because a hue rotation is meaningless in RGB. Kept local and
   allocation-free-ish; it runs on about forty spark buckets and a dozen
   gradient stops a frame, which is nothing next to the bullets. */
function hueShift(r, g, b, deg, sat, lit){
  r/=255; g/=255; b/=255;
  var mx=Math.max(r,g,b), mn=Math.min(r,g,b), l=(mx+mn)/2, h=0, sN=0, d=mx-mn;
  if (d){
    sN = l>0.5 ? d/(2-mx-mn) : d/(mx+mn);
    if (mx===r) h=(g-b)/d + (g<b?6:0);
    else if (mx===g) h=(b-r)/d + 2;
    else h=(r-g)/d + 4;
    h/=6;
  }
  h = (h + deg/360) % 1; if (h<0) h+=1;
  sN = Math.max(0, Math.min(1, sN*sat));
  l  = Math.max(0, Math.min(1, l*lit));
  if (sN < 0.0001){ var v=Math.round(l*255); return [v,v,v]; }
  var q = l<0.5 ? l*(1+sN) : l+sN-l*sN, p = 2*l-q;
  function hz(t){
    if(t<0)t+=1; if(t>1)t-=1;
    if(t<1/6) return p+(q-p)*6*t;
    if(t<0.5) return q;
    if(t<2/3) return p+(q-p)*(2/3-t)*6;
    return p;
  }
  return [Math.round(hz(h+1/3)*255), Math.round(hz(h)*255), Math.round(hz(h-1/3)*255)];
}

/* "255,170,70" -> the same colour this phase. Every telegraph he draws goes
   through here, so adding one is a matter of wrapping its literal. */
function hx(rgb){
  var d = whue(), gl = wglitch();
  if (!d && gl < 0.01) return rgb;
  var p = rgb.split(",");
  var o = hueShift(+p[0], +p[1], +p[2], d, 1 + 0.45*gl, 1 - 0.22*gl);
  return o[0] + "," + o[1] + "," + o[2];
}
var F = {
  on:false, move:null, t:0, next:0, over:null,
  /* HIS POOL IS SIZED TO HIS HITBOX, and it had to move when he grew. Sizing
     him to the arena took his radius from 82px to 139px — a target 1.7 times
     wider, which lands 1.7 times as many bolts without a single number in the
     gun changing. The fight got a third shorter and a player who never dodged
     started WINNING it, which is the balance saying the boss is now free to
     hit. Both pools scale by the SAME factor so the bar's shape is untouched —
     the exposed pool stays 37% of it and the notches stay put. A straight 1.7
     was too much: it handed the win back but left a skilled run finishing on
     2hp after fifty seconds, which is a coin toss rather than a fight. 1.3 is
     where it sits. */
  /* YOUR POOL GREW WITH HIS REACH. Once the shower covered the arena the
     incoming rate settled at about one hit every 1.2s — which is the
     invulnerability window, i.e. as fast as it is possible to be hit — and 100
     went in twenty seconds even when the gap was found every time. The fight
     was the right LENGTH and simply lethal. */
  /* HIS POOL DOUBLED WHEN THE BOARD STOPPED BEING THE GUN. While SPACE only
     fired with the board whole, the player's damage was gated by a rebuild
     loop; without it they fire continuously and the whole fight collapsed to
     sixteen seconds — short enough that STANDING COMPLETELY STILL won it. The
     ratio between the two pools is untouched, so the bar still reads the same:
     shield is the right 63%, exposed health the left 37%. */
  /* FOUR TIMES THE HEALTH, and the fight is now long enough that the escalating
     patterns have room to arrive — the ring at two segments, the spiral at
     three. At the old pool he died before the screen ever filled up. */
  /* HIS POOL IS QUADRUPLED AND STAYS THAT WAY; YOURS AND YOUR GUN MOVED TO
     MEET IT. At 4x health and unchanged output the fight needed 116 seconds and
     the player died at 37 — not hard, just impossible. Raising your damage 1.8x
     and your health 2.6x nets a fight roughly TWICE as long as before rather
     than four times, which is what "quadruple his health" was actually asking
     for: a boss that takes real time to bring down, not one that outlasts you
     by three minutes. */
  /* BOTH NUMBERS SET FROM MEASURED RATES RATHER THAN NUDGED. A competent run
     was removing about 32 damage a second from him and taking about 15 a
     second — so against a 2784 pool it needed 87 seconds and the player had 33
     seconds of life. The fight was not hard, it was arithmetically impossible,
     and no amount of skill closes an 87-vs-33 gap.
       output 32 -> 56/s  puts the kill at ~50s   (BOLT_DMG 4.0 -> 7.0)
       15/s for 50s is 750 damage taken, so 1050 leaves ~30% at the end
     His pool is untouched — still the quadrupled one. */
  /* FOUR TO FIVE MINUTES. With the pads as the weapon the player's damage is a
     STAIRCASE, not a constant: about 10 dps on one lit tile, 26 on two, 47 on
     three, 75 on four, and each step costs fifteen seconds of standing still in
     a bullet hell to buy. Integrating that against a 2784 pool finished in
     about two and a half minutes; 6000 puts it at four and a bit, which is what
     was asked for and also what the staircase wants — the fourth tile has to
     have time left to be worth lighting. */
  /* ONE POOL, AND IT IS SIZED AT THE START rather than written down. See
     walkerPool(): the breaks are a duration and his health is whatever makes
     them last that long at the damage you brought. These two numbers are only
     the value before a fight has begun. */
  hpW:6000, hpWmax:6000, hpM:1050, hpMmax:1050,
  /* ══════════ THE SHIELD IS A GATE NOW, NOT A POOL ═══════════════════════
     It used to be five segments of 760 that you chipped through, and segHP was
     how far into the current one you were. It is a switch now: a tile lighting
     takes the whole thing off, and reaching that break's health gate puts it
     back. So `broken` is either the one segment the intro ram took or all
     five, with nothing in between, and the 3800 points that used to live in
     here moved into hpW. SEGS still sets the ring's geometry - five arcs is
     what he is drawn as - it just does not measure anything any more. */
  broken:[],
  brk:0,        /* 0 = main phase, 1..4 = which shield break we are in */
  won:0,        /* tiles taken so far: the damage staircase's k, AND the
                   escalation level every pattern is now tuned against */
  spd:1,        /* projectile speed multiplier - permanent once earned */
  repair:0, armed:false, iframe:0, station:null, lock:null, shotAt:0, shotAt2:0, roamAt:0,
  aoeTick:0, runeHeat:0, novaHeat:0, aoeGlow:0, bombs:0, bombAt:0,
  dmgBy:{}
};
var shots = [];
/* THE AVOIDABLE HITS HURT; THE CHIP DOES NOT. Doubling his pool doubled the
   fight's length and therefore the damage a player is exposed to, and the
   obvious fix — more player health — has a perverse effect here: the player who
   never moves has the best uptime and kills him FASTEST, so a flat health rise
   hands the win to exactly the player who should not get it.

   So the three telegraphed hits go up and the constant fire stays where it is.
   Dodging is now worth roughly its own health bar over a fight, and standing
   still is worth nothing at all. */
/* THE DAMAGE NEVER FOLLOWED THE HEALTH. Player health went 100 -> 128 -> 190 ->
   500 across four rounds of balancing, and SHOT_DMG stayed at 6 the whole way —
   so a bullet went from costing 6% of a life to costing 1.2%, and with a
   850ms invulnerability window on top of it the entire bullet storm was worth
   about seven health a second. The screen was full and nothing on it mattered.

   Everything is now a fraction of the pool rather than a number carried over
   from a smaller one: a bullet is ~8% of you, the big three are ~18% each.
   Twelve clean hits is dead. */
/* THE INVULNERABILITY WINDOW SETS THE CEILING, NOT THE BULLET COUNT. You can
   only be hit once per IFRAME_MS, so the worst incoming rate this game can ever
   produce is SHOT_DMG/0.85 per second no matter how full the screen is — two
   hundred bullets and twenty do the same maximum damage. That makes SHOT_DMG a
   direct statement about TIME TO DIE STANDING STILL, and it is the only way to
   read it:
       6  ->  71s   (what it was: the storm was decoration)
       38 ->  11s   (lethal to everyone, dodging included)
       16 ->  27s   standing still, and roughly 70s for someone dodging most of
                    it, which is the fight this is meant to be.
   Density does not change the ceiling; it changes how close to it you sit. That
   is exactly what a bullet hell should be measuring. */
/* A BULLET IS A QUARTER OF YOU. Four hits and the fight is over, which is the
   register a bullet hell actually plays in — the fear is not attrition, it is
   that the next one matters. Written as a fraction rather than a number so it
   cannot drift out of step with the health pool again: it did exactly that
   across four rounds of balancing, ending up at 1.2% of a life while the screen
   filled with things that were supposed to be frightening. */
/* {B} FIVE HITS, AND THE BAR IS DRAWN AS FIVE {B}
   A fifth of your health per round rather than a quarter. Every source uses the
   same fraction on purpose - a bullet, a beam tick and a shower tick all cost
   exactly one hit - which is what lets the readout be five boxes instead of a
   bar, and "how many more can I take" a thing you read rather than estimate. */
var HITS_TO_DIE = 5;
var SHOT_FRAC = 1/HITS_TO_DIE;
function shotDmg(){ return F.hpMmax * SHOT_FRAC; }
/* SLOW BULLETS, FAST PLAYER — the ratio is the entire difficulty of a bullet
   hell, far more than the count is. At 250px/s against a player who moves 334
   the field was almost as fast as the person threading it, so density had
   nowhere to be dodged INTO: four hits happened inside seven seconds no matter
   how well the gaps were read. Genre standard is a player roughly three times
   the speed of what is thrown at them, which is what makes a screen of two
   hundred bullets a puzzle rather than a wall. 155 against 430. */
var SHOT_EVERY=1050, SHOT_SPEED=155;
/* THE AOE IS THE ONE ATTACK YOU CANNOT BE LUCKY ABOUT. With a nine-pixel
   hitbox, a player who never moves still survives most bullets by accident —
   which is fine for the aimed patterns (missing is the point of a small hitbox)
   and wrong for this, because the shower has no gaps except the one door. So
   the AOE carries the weight of the "you must move" lesson and hits for a
   quarter of your health when you are not in the door. Anyone standing in it is
   taking nothing, so this costs a good player exactly zero. */
/* 1.5s of shower, a tick every 260ms: about 250 if you stand in it start to
   finish, nothing at all if you are in the door. The most damaging thing in the
   fight is also the most completely avoidable. */
/* A LONGER WIND-UP, because the wedge showing where the door is only helps if
   there is time to walk to it. 2.6s from the first spark to the shower. */
/* ═══════ STANDING IN THE SHOWER KILLS YOU IN ABOUT A SECOND ═══════════════
   It was 44 damage a tick against a 1050 pool — four percent, twenty-four ticks
   to die, six seconds of standing inside a wall of fire. That is chip damage
   wearing the costume of a screen-filling attack, and it taught the player that
   the biggest thing he does is survivable, which is the opposite of the lesson.

   A QUARTER OF YOU PER TICK, four ticks a second: caught in the open you are
   dead in a bit over a second. Written as a fraction for the same reason the
   bullets are — every previous absolute number silently became meaningless the
   next time the health pool moved, and this one has moved four times.

   It is only fair because the door is now genuinely reachable and genuinely
   telegraphed: held still for the whole 2.6s wind-up, aimed at a point inside
   your half, drawn as a wedge the entire time. Survivable by knowing where to
   be, and by nothing else. */
/* ══ 2000ms, AND THE GEOMETRY IS WHAT MAKES THAT ENOUGH ════════════════════
   This went to 3600 when the safe spot was a screen corner BEHIND him, which
   made the answer a full diagonal sprint across the arena — the worst honest
   run measured 3.20s. The wedge now opens into the middle of the far side,
   which is most of the way to where the fight already leaves you standing, so
   the run is a fraction of that and the long charge became exactly the dead
   waiting the nova was told off for. */
/* ════════════════════ EIGHT HUNDRED MORE MILLISECONDS TO BE SOMEWHERE ════════════════════
   The shower asks you to be inside a 23-degree wedge and the nova asks you to
   be out of the middle, and both were asking from across the arena. Both
   wind-ups gained 0.8s. They live in TUNE as well, so the panel moves them. */
var AOE_WIND=2600, AOE_FIRE=1500, AOE_FRAC=1/HITS_TO_DIE, AOE_TICK_MS=260;
var AOE_SPIN_UP=420;   /* ms from standstill to full sweep — see the gate */
function aoeDmg(){ return F.hpMmax * AOE_FRAC; }
/* LONG AND HARD, DELIBERATELY. A quarter of your health per bullet and a fight
   that runs about a minute is a demanding combination on purpose: four hits is
   the entire encounter, so it is not an attrition fight you grind down, it is
   one you have to play nearly clean from start to finish. Raising this number
   would shorten the fight and blunt exactly that.

   The clearing blast is what keeps it fair rather than merely punishing — every
   hit hands back a guaranteed pocket of empty space, so a mistake costs a
   quarter of your life and never cascades into the next one. */
var BOLT_EVERY=115, BOLT_SPEED=820, BOLT_DMG=7.0;
var REPAIR_MS=2400, IFRAME_MS=850;

/* ═══════════════ THE RUNES: A HORIZONTAL LINE, NOT A PLACE ════════════════
   The two marks already painted on his flanks light up, and when they finish
   charging they fire straight out sideways. Because they are LEVEL WITH EACH
   OTHER the two beams read as one unbroken line across the arena, and that is
   the whole point of the attack: every other move asks where to stand, this one
   asks only whether you are above him or below him. One bit of information,
   under pressure, while the bullets keep coming.

   It is also the only attack that is not centred on him — he is at the ceiling,
   so the line is near the top, which means the correct answer is almost always
   "drop" and the mistake is getting caught drifting up. */
/* ═════════════ THE NOVA: GET TO THE WALL ══════════════════════════════════
   He leaves the ceiling, takes the middle of the arena, and detonates. Nothing
   survives except the outer rim — the four corners most of all, because they are
   the furthest points from the centre that exist.

   IT IS THE INVERSE OF EVERY OTHER MOVE HE HAS. The AOE says "find the one safe
   sector"; the runes say "pick a side of a line"; this one says there is no
   clever answer, RUN. Alternating it with the other two means the player never
   settles into one kind of reading.

   THE RADIUS IS DERIVED, NOT PICKED. Safe is outside 0.86 of the half-diagonal:
   on a 1280x820 arena the corners sit 760px from centre and the middle of the
   side walls 640, so a threshold of 654 leaves the corners clear and the flat
   edges lethal. That is the difference between "get to the edge" and "get to a
   CORNER", and it is the entire shape of the dodge. */
/* ══════════ THE CHARGE WAS 1.2 SECONDS OF STANDING AROUND ══════════════════
   Measured on a 966x910 arena: he takes 0.93s to cross to the middle and then
   charged for 2.19s, so 3.12s of warning against a worst case that needs 1.70s
   — a perfect full-speed diagonal run from DEAD CENTRE to the safe radius at
   571px. 1.42s of pure slack, which is what it felt like.

   1000ms. The walk is now load-bearing: from dead centre you have 1.93s for a
   1.70s run, so you must already be moving when he starts crossing. That is
   the pathological case and it is meant to be tight. From where the fight
   actually puts you — a pad, 309px out — the run is 0.75s against the 1.00s
   charge alone, without needing the walk at all. */
var NOVA_TELL=1800, NOVA_FIRE=1400;
var NOVA_SAFE=0.86;                /* of the half-diagonal */
/* ══════ HE STANDS IN THE MIDDLE OF THE SCREEN ════════════════════════
   Not the middle of the play area. I moved it there when the wall went in and
   that was wrong: the arena the player LOOKS at is the whole screen, and a
   360-degree blast that is visibly off-centre reads as a mistake however
   correct the arithmetic is.

   THE RADIUS IS THE PART THAT HAS TO KNOW ABOUT THE WALL. He is at the screen
   centre, but the right-hand third of the screen is not yours - so the only
   places far enough away are on the LEFT, and how far you must run has to be
   measured against how far you can actually GET rather than against how wide
   the screen is.

   Sized off the screen's half-diagonal it left a 5% sliver on the far edge
   needing 1.23s to reach against a 1.00s charge: unsurvivable from mid-board,
   and nothing about it looked wrong on screen. novaReach() is the distance to
   the furthest corner you are ALLOWED to stand in, so his position is the
   screen's and the run is the room's. */
function novaCentre(){ return { x:VW()*0.5, y:VH()*0.5 }; }
function novaReach(){
  var c = novaCentre();          /* furthest legal corner: both are on the left */
  return Math.max(Math.hypot(c.x, c.y), Math.hypot(c.x, VH()-c.y));
}
function novaSafeR(){ return NOVA_SAFE * novaReach(); }

var RUNE_X=0.31, RUNE_Y=0.02;      /* rune offset, as a fraction of his box */
var RUNE_CHARGE=1800, RUNE_FIRE=1400, RUNE_H=26;
var RUNE_ROLL=0.13;      /* radians either side of level — about 7.4 degrees */
/* THE MARKS RIDE HIS ROTATION. Fixed offsets would leave the emitters hanging
   in space while the medallion under them turned, and the beams would keep
   firing dead level out of a boss that is visibly tilted. */
/* the direction a mark fires: his own local x axis, rolled with him */
function beamDir(sign){ return [Math.cos(W.ang)*sign, Math.sin(W.ang)*sign]; }

function runePos(){
  var rx=WALK*RUNE_X, ry=WALK*RUNE_Y, a=W.ang;
  var ca=Math.cos(a), sa=Math.sin(a);
  return [
    { x: W.x + (-rx*ca - ry*sa), y: W.y + (-rx*sa + ry*ca), dir:-1 },
    { x: W.x + ( rx*ca - ry*sa), y: W.y + ( rx*sa + ry*ca), dir: 1 }
  ];
}

function shieldLeft(){ return SEGS - F.broken.length; }
/* the wrap handled once, in one place — every sector test is "is this angle
   within `span` counter-clockwise of a0", and inlining that is how a sector
   silently stops matching near the seam at 0/2pi */
function inSector(a,a0,span){ var d=(a-a0)%6.28318; if(d<0)d+=6.28318; return d<span; }
function gapAt(a){ return gapIn(a, F.broken); }

/* ══════════ A SHOWER IS COMMITTED AT THE MOMENT IT STARTS ═════════════════
   Breaking a segment DURING an AOE used to rewrite the attack underneath the
   player: a new gap appeared out of nowhere, the emission pattern jumped, and
   the spin rate stepped up mid-shower because it is derived from how many
   segments are gone. It looked like the effect glitching and resetting, and it
   was — the attack was reading live state that the player was actively changing.

   So the move takes a COPY of the broken list and the spin rate when it begins
   and uses those until it ends. Damage you deal during a shower still lands and
   still shows on him; it simply applies to the NEXT one. An attack that changes
   its own rules while it is in the air cannot be dodged on purpose. */
/* THE DOOR IS WIDER THAN THE SEGMENT THAT MADE IT. A 72-degree corridor is a
   slot; at the distance the player stands from him it is barely wider than they
   are, and a sweeping slot would be a coin toss rather than a chase. It is
   drawn at the same width it is tested at, so what you see is what burns. */
/* THE DOOR'S OWN BEARING, in screen space, independent of how fast the wheel
   happens to be turning. Null when no AOE is running, in which case the old
   behaviour stands and the gaps are sectors of the ring. */
function doorCentre(){
  var M = F.move;
  return (M && M.id==="aoe" && M.doorAng !== undefined) ? M.doorAng : null;
}

/* ══════ I THOUGHT THE TURNING DOOR HAD A PARALLAX. IT DOES NOT. ═══════════
   The theory was that sparks reaching you now were fired a while ago and aimed
   by the door as it stood THEN, so a damage test against the door's CURRENT
   bearing would drift further from the visible hole the further out you stood.
   It is a good theory and the canvas says it is wrong. Sampled across the real
   shower, the drawn hole's centre sits at:

       r=260  -38deg     r=500  -33deg
       r=380  -34deg     r=620  -34deg

   against a door whose current bearing is -38. Within about four degrees, at
   every distance — the hole tracks NOW, not some earlier bearing.

   The reason the correction was worse than the bug is that the wavefront is the
   EARLIEST possible emission, so using it assumes every spark at your radius is
   one of the first and slowest. They are not: they leave at anything from 950
   to 2450px/s, so at any radius there is a mix of emission times, and the newest
   arrivals define the edges of the hole. Rewinding to the front put the hitbox
   21 to 30 degrees off the picture — worse than the four degrees it set out to
   remove. Left as it was, and measured this time. */
function gapIn(a, list){
  var dc = doorCentre();
  if (dc !== null) return inSector(a, dc - DOOR_SPAN/2, DOOR_SPAN);
  for (var i=0;i<list.length;i++)
    if (inSector(a, list[i]*SEG + W.ang - (DOOR_SPAN-SEG)/2, DOOR_SPAN)) return true;
  return false;
}
function liveGaps(){ return (F.move && F.move.gaps) ? F.move.gaps : F.broken; }
function liveSpin(){ return (F.move && F.move.spin !== undefined) ? F.move.spin : aoeSpin(); }
/* THE DAMAGE TEST USES THE EMISSION-TIME DOOR, the emitter uses the live one.
   aoeSparks() is choosing an angle for a spark leaving him RIGHT NOW, so "now"
   is correct there; the player is being hit by sparks that left a while ago, so
   "now" is exactly wrong here. Both call gapIn; only this one rewinds. */
function playerInGap(){ var m=pC(); return gapIn(Math.atan2(m.y-W.y, m.x-W.x), liveGaps()); }
/* WHICH SEGMENT IS POINTING THAT WAY RIGHT NOW. Ring-local sector i lives at
   i*SEG and the whole ring is drawn rotated by W.ang, so the sector covering a
   given screen angle depends on where the spin happens to be. */
function segmentAt(a){
  for (var i=0;i<SEGS;i++) if (inSector(a, i*SEG + W.ang, SEG)) return i;
  return 0;
}

/* ── the board is the gun ──────────────────────────────────────────────── */
/* MARKED, NOT REMOVED. paintBoard() owns these elements and rewrites their
   className on every repaint, so emptying the board would be undone by the
   next draw. `window.bossDead` is read there, exactly as `bwKnocked` already
   is for the takeover's storm. */
window.bossDead = null;

/* ══════════════════ THE BOARD DOES NOT COME BACK ═══════════════════════════
   It used to be your gun: he smashed it, you stood on the frame to rebuild it,
   and SPACE only fired while it was whole. That loop is gone and this is a
   BULLET HELL — the board is destroyed in the cutscene and the fight is you,
   him, and what he throws.

   WHAT THAT COSTS AND WHAT IT BUYS. It costs the fight its economic hook: there
   is no longer a reason the keno board matters to the fight. It buys a fight
   with ONE verb — move — where every attack asks a different question of that
   verb and nothing competes with dodging for the player's attention. For a
   first mini-boss that is the better trade; the rebuild loop asked the player
   to learn two games at once. */
var boardGone = false;

function repaint(){ if (typeof paintBoard === "function") paintBoard(); }
/* NO EARLY RETURN ON `!F.armed`. It looked like a cheap guard against repeated
   work and it silently did nothing at the only moment that matters: the board
   is not armed when the fight begins, so the ram's own shatter marked no tiles
   at all and the frame came back whole. Marking is idempotent; the guard was
   protecting against nothing. */
function disarm(){
  F.armed = false; F.repair = 0;
  window.bossDead = {};
  for (var t=1;t<=BOARD.tiles;t++) window.bossDead[t]=1;
  repaint();
}
function rearm(){ F.armed = true; F.repair = 1; window.bossDead = null; repaint(); }

/* THE TILES LEAVE. They are cloned out of the live board and flown off screen;
   the originals stay put and go dark, because they are what you rebuild. */
function shatterBoard(){
  var b = $("board"); if (!b) return;
  var c = boardBox();
  [].forEach.call(b.children, function(el){
    var r = el.getBoundingClientRect();
    var d = el.cloneNode(true);
    d.className = "bossshard " + el.className;
    d.style.width = r.width+"px"; d.style.height = r.height+"px";
    var dx = (r.left+r.width/2)-c.x, dy = (r.top+r.height/2)-c.y, L = Math.hypot(dx,dy)||1;
    shards.push({ el:d, x:r.left, y:r.top, w:r.width, h:r.height, a:0,
      vx: dx/L*55 + (Math.random()-0.5)*95,
      vy: dy/L*55 + (Math.random()-0.5)*95 - 18,
      va: (Math.random()-0.5)*1.5 });
    $("bossStage").appendChild(d);
  });
  /* THE WHOLE CARD GOES, not just the tiles. Leaving the empty frame behind was
     right when it was a socket you rebuilt into; with nothing to rebuild it is
     furniture standing in the middle of a bullet hell. */
  boardGone = true;
  document.body.classList.add("boardgone");
  disarm();
}
function shardStep(dt){
  for (var i=0;i<shards.length;i++){
    var s = shards[i];
    s.vx *= 1+0.55*dt; s.vy *= 1+0.55*dt;
    s.x += s.vx*dt; s.y += s.vy*dt; s.a += s.va*dt;
    if (s.x+s.w < -40 || s.x > VW()+40 || s.y+s.h < -40 || s.y > VH()+40){
      s.el.remove(); shards.splice(i,1); i--; continue;
    }
    s.el.style.transform = "translate("+s.x.toFixed(1)+"px,"+s.y.toFixed(1)+"px) rotate("+s.a.toFixed(3)+"rad)";
  }
}
function shardsClear(){ shards.forEach(function(s){ s.el.remove(); }); shards = []; }

/* ── damage ────────────────────────────────────────────────────────────── */
/* WHERE THE DAMAGE CAME FROM. A tally rather than a guess: balancing this
   fight by reasoning about which attack "probably" dominates produced three
   wrong answers in a row. Costs one object and answers the only question that
   matters when the difference between a good run and a bad one is small. */
/* `raw` SKIPS THE INVULNERABILITY WINDOW AND THE BLAST, and only the AOE uses
   it. The window exists so a wall of bullets cannot delete you in a single
   frame — a mercy against things you cannot individually see coming. The shower
   is not that: it is one attack, telegraphed for two seconds, with a door drawn
   on the screen. Standing in it should cost you continuously; finding the door
   should cost you nothing.

   Measured before that change, across a whole fight: the AOE did 92-184 while
   bullets did 368-624, and the player who NEVER MOVED took less AOE than the
   ones who dodged — a stationary target sits inside a 72-degree gap one time in
   five by luck. The signature mechanic was a dice roll. */
/* {B} INVULNERABLE, FOR TESTING ONLY {B}
   Reading a phase properly means watching it for its full thirty seconds, and
   at a quarter of your health per round that is not something you get to do
   twice running. `I` toggles it, `?dev` only, and the phase tag says so in red
   the whole time it is on - so a balance reading is never taken through it by
   accident. */
var GODMODE = false;
function hurtPlayer(n, src, raw){
  if (rewinding || GODMODE) return;
  if ((!raw && F.iframe>0) || !F.on || F.over) return;
  F.dmgBy[src||"?"] = (F.dmgBy[src||"?"]||0) + n;
  F.lastHitBy = src || "?";     /* whatever lands the last one is the cause */
  F.hpM = Math.max(0, F.hpM-n);
  if (!raw){
    F.iframe = IFRAME_MS;
    P.vx *= -0.5; P.vy *= -0.5;
    playerBlast();
  }
  knock(260,70,0.18,0.20);
  SFX.hit();
  kick(raw ? 0.25 : 0.9, raw ? 0.18 : 0.5, "255,70,50");
  if (F.hpM<=0) playerDied();
}

/* ════════════════════ DYING IS AN EVENT, NOT A FLAG ════════════════════
   It used to be one assignment to F.over, which left the shard coasting under
   its own momentum across the arena while YOU DIED sat on the screen, the boss
   music still going, and nothing anywhere counting. */
/* one place that knows about both, because there are now five callers and a
   half-stopped soundtrack is the kind of bug nobody reports and everybody
   hears */
function musicStop(){
  try { if (MUSIC){ MUSIC.pause(); MUSIC.currentTime = 0; MUSIC.volume = musVol(); } } catch(e){}
  try { if (MUSIC2){ MUSIC2.pause(); MUSIC2.currentTime = 0; MUSIC2.volume = 0; } } catch(e){}
  MUSIC_CUR = MUSIC;
}
function musicPause(){
  try { if (MUSIC) MUSIC.pause(); } catch(e){}
  try { if (MUSIC2) MUSIC2.pause(); } catch(e){}
}
function musicResume(){
  if (muted()) return;
  var t = MUSIC_CUR || MUSIC;
  try { var p = t.play(); if (p && p.catch) p.catch(function(){}); } catch(e){}
}
/* ════════════════════ WHAT ACTUALLY HAPPENS TO PEOPLE ════════════════════
   F.dmgBy has been accumulating damage per source this whole time and NOTHING
   has ever read it - collected every fight and thrown away at the next
   fightStart(). The death counter was persisted but only as a total, so the one
   question worth asking of it ("what is killing them?") could not be answered.

   Now: runs, deaths, wins, total time in the arena, the furthest phase reached,
   and a tally of what landed the killing blow. Kept in one localStorage key as
   JSON, loaded through a defaulted shape so a key written by an older build, or
   half-written, or edited by hand, cannot throw on read. */
var STATS_KEY = "kenoidle.walker.stats";
function statsLoad(){
  var d = { runs:0, deaths:0, wins:0, ms:0, best:0, byCause:{} };
  try {
    var o = JSON.parse(localStorage.getItem(STATS_KEY));
    if (o && typeof o === "object"){
      if (typeof o.runs   === "number") d.runs   = o.runs;
      if (typeof o.deaths === "number") d.deaths = o.deaths;
      if (typeof o.wins   === "number") d.wins   = o.wins;
      if (typeof o.ms     === "number") d.ms     = o.ms;
      if (typeof o.best   === "number") d.best   = o.best;
      if (o.byCause && typeof o.byCause === "object") d.byCause = o.byCause;
    }
  } catch(e){}
  return d;
}
function statsSave(){ try { localStorage.setItem(STATS_KEY, JSON.stringify(STATS)); } catch(e){} }
var STATS = statsLoad(), statFlush = 0;
/* TIME IS BANKED AS IT PASSES, not at the end of a run. Most runs do not end -
   they are abandoned, reloaded, or the tab is closed - and a counter that only
   writes on death would report a fraction of the time actually spent. Flushed
   every five seconds so a hard close loses at most that. */
function statsTime(dt){
  STATS.ms += dt*1000;
  statFlush += dt;
  if (statFlush >= 5){ statFlush = 0; statsSave(); }
}
function statsEnd(won){
  if (won) STATS.wins++;
  else {
    STATS.deaths++;
    var c = F.lastHitBy || "?";
    STATS.byCause[c] = (STATS.byCause[c]|0) + 1;
  }
  if ((F.won|0) > STATS.best) STATS.best = F.won|0;
  statsSave();
}

var DEATH_KEY = "kenoidle.walker.deaths";
function deathCount(){
  try { return (+localStorage.getItem(DEATH_KEY)) || 0; } catch(e){ return F.deaths|0; }
}
function playerDied(){
  if (F.over) return;
  F.over = "walker";
  SFX.death();
  /* the input goes too - a key held through the death would otherwise still be
     held when the next run starts */
  P.vx = 0; P.vy = 0; clearKeys();
  var n = deathCount() + 1;
  try { localStorage.setItem(DEATH_KEY, String(n)); } catch(e){}
  F.deaths = n;
  statsEnd(false);
  musicStop();
}

/* ══════════════════ THE HIT CLEARS THE ROOM ════════════════════════════════
   A quarter of your health per bullet means four hits is the whole fight, and
   at that price the deadliest moment in a bullet hell is the INSTANT AFTER a
   hit: you are somewhere you did not choose to be, with the pattern that caught
   you still arriving. Invulnerability alone does not fix it — it runs out while
   you are still inside the thing.

   So the hit detonates. Everything within CLEAR_R is deleted, which buys the
   one thing the player actually needs, which is somewhere to stand. It is also
   why the damage can be this brutal at all: the punishment is severe and the
   recovery is guaranteed, rather than the punishment being mild and the
   recovery being luck. */
/* ═══════════════ THE PADS: HOW YOU ACTUALLY DO DAMAGE ══════════════════════
   Holding a fire button was a placeholder and never had anything to do with the
   game it is attached to. This does: your keno tiles are scattered across your
   half of the arena, you STAND ON ONE to power it up, and a powered tile fires a
   laser at him for the rest of the fight.

   IT IS THE OPPOSITE OF DODGING, WHICH IS THE POINT. Everything else in the
   fight is about not being somewhere; this is about being somewhere and staying
   there while a hailstorm crosses the screen. The tension is entirely in that
   contradiction, and it is why the pads are scattered rather than in a line —
   the safe sector of an AOE and the pad you were charging are rarely the same
   place, so you are constantly choosing between progress and survival.

   CHARGE IS CUMULATIVE, NOT CONTINUOUS. Fifteen seconds of UNBROKEN hovering is
   not survivable in this arena and never will be — you would be asking the
   player to ignore three attacks in a row. It banks instead: step off to dodge,
   come back, carry on from where you were. Same fifteen seconds of contact,
   spread over as many visits as it takes.

   YOUR BET AND YOUR AUTO-PLAY SET THE DAMAGE, which is the whole reason the
   idle game is attached to a boss fight at all — everything you bought before
   walking in here is in that number, and a player who has upgraded arrives with
   lasers that hurt.

   AND THEY COMBINE. Two lasers are worth more than two lasers: the beams
   converge into a single trunk and the total scales superlinearly, so the third
   pad is worth more than the first. That is what makes charging a fourth one
   worth the risk instead of a rounding error. */
/* ════════════════════ THIRTEEN AND A HALF SECONDS ON A TILE ════════════════════
   Ten was set when standing still was merely dangerous. It now also buys a bomb
   and a quarter of your health, the main phase opens on a shower rather than on
   the runes, and the hell no longer pauses for his own moves - so the price of
   a tile went up to match what it pays for. It is the whole length of a main
   phase; the break it buys is thirty seconds at the tuned bet.

   On the panel, because this is the number most likely to move again. */
var PAD_W = 116, PAD_CHARGE_MS = 13500, PAD_MAX = 8;

/* FOUR, FOR NOW, EXPLICITLY. It should be "however many you have unlocked" and
   it will be again the moment the progression sets where this fight sits in the
   ladder — this is a pin, not a design. */
var PAD_FORCE = 4;

/* ══════════════════ THE FOCUS, AND WHY IT EXISTS ═══════════════════════════
   The tiles used to fire at Walker directly and meet in mid-air on the way,
   which drew fine and meant nothing: the meeting point was wherever the average
   of the lit tiles happened to be, so it moved every time one lit and belonged
   to nothing.

   A DIAMOND IS AN OBJECT. The tiles feed it, it focuses what they give it into
   one ray, and it stands in a fixed place — so the beams are a circuit with a
   shape rather than four lines that happen to overlap. More tiles lit is more
   feeding the same thing, which is exactly what the superlinear damage already
   said and now has a picture. */
function focusPos(){ return { x: VW()*0.52, y: VH()*0.50 }; }

/* ════════════════════ THE FOCUS IS THE 1000x GEM ════════════════════
   It was a hand-drawn rhombus with two facet lines - a diagram of a gem rather
   than the gem. The game already HAS this object: the rainbow stone that lands
   on the board at the top multiplier tier, and it is the most valuable-looking
   thing in the whole product. The tiles feed it, so it should be that.

   `artGem` and the 1000 tier's colours are lifted verbatim from index.html so
   the two cannot drift; rasterised once into an <img> off a data URI, because
   sixteen facet paths a frame on a canvas that is already drawing four hundred
   bullets is not a trade worth making. NO LABEL - the "1000x" is a separate DOM
   element on the board and does not come with it. */
var GEM = { deep:"#1a1030", rim:"#ffffff", line:"#120a24", table:"#fff6fb", rainbow:1 };
function artGem(g){
  var GX=22, GY=22, GR=19.4, GT=7.6, i;
  function pt(r,deg){ var a=deg*Math.PI/180; return [GX+r*Math.cos(a), GY+r*Math.sin(a)]; }
  function dd(p){ return p.map(function(x,ix){ return (ix?"L":"M")+x[0].toFixed(2)+" "+x[1].toFixed(2); }).join("")+"Z"; }
  var table=[], girdle=[];
  for (i=0;i<8;i++)  table.push(pt(GT, i*45+22.5));
  for (i=0;i<16;i++) girdle.push(pt(GR, i*22.5+11.25));
  var v='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 44 44">'+
        '<circle cx="22" cy="22" r="'+GR+'" fill="'+g.deep+'"/>';
  for (i=0;i<16;i++){
    var f = g.rainbow ? "hsl("+(i*22.5)+" 92% "+(i%2?72:58)+"%)" : g.facets[i%8];
    v += '<path d="'+dd([girdle[i], girdle[(i+1)%16], table[Math.round(i/2)%8]])+
         '" fill="'+f+'" stroke="'+g.line+'" stroke-width=".45" stroke-opacity=".5"/>';
  }
  v += '<path d="'+dd(table)+'" fill="'+g.table+'" stroke="'+g.line+'" stroke-width=".6" stroke-opacity=".6"/>';
  v += '<circle cx="22" cy="22" r="'+GR+'" fill="none" stroke="'+g.rim+'" stroke-width="1.3"/>';
  v += '<path d="M13 11.5 L18 11.5 L14.6 16 Z" fill="#fff" opacity=".8"/></svg>';
  return v;
}
var gemSpin = 0;
/* ════════════════════ HIS ANGLE HAS TO BE WRAPPED, AND NOTHING WAS DOING IT ════════════════════
   W.ang is integrated as `W.ang += W.spin * dt` and never brought back into
   range, so after a minute of spinning it is tens of radians. That is invisible
   almost everywhere - sin and cos do not care - and catastrophic in the one
   place that INTERPOLATES it: the rune wind-up eases W.ang toward 0 to level
   him before he fires, and easing 40 radians down to 0 walks through every
   multiple of 2pi on the way. On screen that is the boss whipping round several
   times during the wind-up, with the beam tell sweeping the whole room, which
   reads exactly like an attack that should already have killed you.

   Wrapped at the two places that integrate it, so "level" is never more than
   half a turn away and the tell settles instead of spinning. */
function wrapAng(a){ return ((a + Math.PI) % 6.28318 + 6.28318) % 6.28318 - Math.PI; }
var GEM_IMG = (function(){
  try {
    var im = new Image();
    im.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(artGem(GEM));
    return im;
  } catch(e){ return null; }
})();

/* EACH TILE KEEPS ITS OWN COLOUR while it is cold, and its number is drawn in
   the same one. That is straight off the reference sheet, and it does real work
   beyond looking good: eight identical grey squares are eight of the same
   thing, but eight coloured ones are eight PLACES, and after one fight you
   remember "the green one is the awkward one" without ever being told. */
function padHue(i){ return (i*47 + 15) % 360; }
var pads = [];

/* fractions of the arena, all inside your half, spread so that no two are
   comfortable to hold during the same attack */
/* ========== ALL OF THEM THE SAME DISTANCE FROM THE CRYSTAL =================
   They were placed by hand as fractions of the arena, which looked scattered
   because it WAS scattered - four different distances and four different
   bearings, so nothing about the arrangement said they belonged to each other
   or to the thing in the middle of them.

   On an arc they read as one apparatus: same radius, evenly spaced, every beam
   the same length. It also makes them mechanically equal, which they always
   were in the maths - an equidistant ring is the honest picture of four tiles
   that each contribute exactly the same amount.

   The radius comes from the arena so they stay on screen at any size, and the
   spread is the left half, because that is the side he is not on. */
var PAD_ARC_FROM = 2.20, PAD_ARC_TO = 4.08;   /* down-left round to up-left */
function padRadius(){ return Math.min(VW()*0.32, VH()*0.40); }

/* WHAT YOU BROUGHT WITH YOU. Read once, when the fight starts, so a laser does
   not change strength halfway through because an upgrade ticked over. */
function padPower(){
  var betC = 1, sps = 0;
  try { if (typeof derived === "function"){ var D = derived(); betC = D.betCents || 1; } } catch(e){}
  try { if (typeof autoSps === "function") sps = autoSps() || 0; } catch(e){}
  /* a first pass, and it will want tuning against the real ladder: a cent of
     stake is worth about as much as a tenth of a draw per second */
  return 9 + Math.min(70, betC * 0.85) + Math.min(46, sps * 7);
}

function buildPads(){
  pads = [];
  var n = PAD_FORCE;
  var fp0 = focusPos(), rad = padRadius();
  for (var i=0;i<n;i++){
    /* evenly spaced along the arc; a single pad sits dead left rather than at
       one end of a spread that no longer exists */
    var f = (n===1) ? 0.5 : i/(n-1);
    var ang = PAD_ARC_FROM + (PAD_ARC_TO-PAD_ARC_FROM)*f;
    var sp = [ (fp0.x + Math.cos(ang)*rad)/VW(), (fp0.y + Math.sin(ang)*rad)/VH() ];
    /* THE TILES YOU HAVE UNLOCKED, AND ONLY THOSE. Spreading numbers across the
       full forty was wrong twice: it put tiles on the floor that the player has
       not earned yet, and it made the arena claim a bigger board than they
       actually own. These ARE tiles 1..n of your board — at the point Walker
       shows up that is about eight, and every one of them is a square you have
       really been playing on. */
    /* `won` IS PERMANENT, `on` IS RIGHT NOW. A tile you have taken stays
       taken for the rest of the fight - it simply goes dark when the shield
       comes back and lights again, free, the next time it goes off. */
    pads.push({ x: VW()*sp[0], y: VH()*sp[1], t:0, on:false, won:false,
                n: i+1, hue: padHue(i) });
  }
  F.padPower = padPower();
}
function padsActive(){
  var k=0; for (var i=0;i<pads.length;i++) if (pads[i].on) k++;
  return k;
}
/* superlinear on purpose — see the note above */
function padDPS(){
  var k = padsActive();
  return k ? F.padPower * k * (1 + 0.30*(k-1)) : 0;
}

/* ARE YOU STANDING ON A TILE RIGHT NOW? Same box the charge uses, so it is
   the same thing the player already understands - if the tile is filling, you
   are on it. Lit tiles count too: a tile you have finished charging is still a
   tile you are standing on. */
/* UNREFERENCED SINCE THE SNIPE WAS REMOVED. It answered exactly one question -
   "is the player standing on a tile right now" - and the snipe gate was the
   only caller. Kept because it is three lines of correct geometry and the next
   thing that wants to press a charging player will want it; noted because an
   unused helper with no explanation reads as something that lost its wiring. */
function onAnyPad(){
  if (!P.live) return false;
  var m = pC();
  for (var i=0;i<pads.length;i++){
    if (Math.abs(m.x-pads[i].x) < PAD_W*0.5 && Math.abs(m.y-pads[i].y) < PAD_W*0.5)
      return true;
  }
  return false;
}

function stepPads(dt){
  if (!F.on || F.over || !P.live || rewinding) return;
  /* ════════════════════ A TILE IS BOUGHT IN THE MAIN PHASE AND SPENT IN THE BREAK ════════════════════
     With the shield off there is nothing left to charge - every tile you own
     is already burning him, and the floor is yours to run on. Charging only
     happens while the shield is UP, and that is what stops a main phase being
     an interlude: it is the thirty feet of open ground where you stand still
     in front of him for ten seconds to buy the next break. */
  if (F.brk){ hitWalker(padDPS() * dt); return; }
  var m = pC();
  for (var i=0;i<pads.length;i++){
    var pd = pads[i];
    if (pd.won) continue;
    if (Math.abs(m.x-pd.x) < PAD_W*0.5 && Math.abs(m.y-pd.y) < PAD_W*0.5){
      pd.t += dt*1000;
      if (pd.t >= PAD_CHARGE_MS){
        pd.t = PAD_CHARGE_MS;
        breakShield(pd);          /* this is what sets F.won, so read it after */
        SFX.loot();
        lootShow(F.bombs);
      }
    }
  }
}

/* THE ROOM IS EMPTY FOR THIS LONG after the shield changes hands either way.
   Both transitions wipe the screen, and dropping a wind-up into the first
   frame after a wipe spends the clear on nothing. */
var PULSE_GRACE = 1600;
/* how long the very first main phase waits before he does anything at all */
var OPEN_PAUSE = 2200;

/* ════════════════════ A WIPE THAT REFILLS IN THE SAME FRAME IS NOT A WIPE ════════════════════
   Emptying `shots` is not enough on its own: every pattern whose interval had
   already elapsed fires on the very next tick, so the pulse cleared 218
   bullets and 33 were back before the shockwave had left him. Pushing each
   pattern's last-fired stamp INTO THE FUTURE buys the same beat of quiet the
   big moves already get, and the hell builds back up from an empty floor
   rather than snapping back to where it was. */
function patHush(){
  var i, t = (F.clock || 0) + PULSE_GRACE;
  for (i=0;i<patAt.length;i++) patAt[i] = t;
}

/* ════════════════════ THE PULSE, AND WHAT IT COSTS HIM ════════════════════
   Lighting a tile does not chip the shield - it takes the whole thing off at
   once and clears the room doing it. The clear is the point. You have just
   spent ten seconds standing still in a bullet hell to earn this, and what it
   buys should start from an empty floor rather than from whatever happened to
   be in the air when the timer ran out. */
function breakShield(pd){
  pd.won = true;
  F.won++;
  F.brk = F.won;
  /* ════════════════════ EVERY TILE YOU OWN LIGHTS, NOT JUST THE ONE THAT CHARGED ════════════════════
     padDPS() counts pads that are `on`, so lighting only the new one pinned
     the staircase at x1 for the whole fight - and the only symptom was that
     the later breaks took longer, which is exactly what a fight with more
     health in each bite is SUPPOSED to look like. Break 2 ran 99 seconds
     against the 38 it is designed for and nothing anywhere said so. */
  for (var p=0;p<pads.length;p++) if (pads[p].won) pads[p].on = true;
  /* PERMANENT, AND IT COMPOUNDS INTO THE MAIN PHASES TOO. The nova you meet
     after the third break throws its creeping galaxies 15% faster than the one
     that opened the fight, without a number inside the move changing. */
  F.spd = 1 + 0.05*(F.won - 1);
  F.brkPost = topStation();      /* where he plants for this whole break */
  /* THE LAST BREAK IS THE DEATH - see finBegin(). Placed after brkPost so it
     can override the patrol station it just chose. */
  if (F.brk === PAD_FORCE) finBegin();
  F.pulseAt = 0;
  /* ════════════════════ EVERY TILE PAYS YOU ════════════════════
     Ten seconds standing still in a bullet hell is the most dangerous thing the
     fight asks for, and until now the only thing it bought was a bigger number
     on his bar. A bomb and a quarter of your health means the staircase is a
     RESOURCE decision as well as a damage one - and it is what makes taking the
     fourth tile survivable rather than merely optimal. */
  /* filled to whatever the new tile count allows - see bombMax() */
  F.bombs = bombMax();
  /* 30% - one and a half hits back, so a tile is worth taking even at full
     health minus one, and never quite a free extra life */
  F.hpM = Math.min(F.hpMmax, F.hpM + F.hpMmax*0.30);
  /* the hue is thrown forward and falls back over the next second or so */
  pulseHue = 150;
  /* every segment, not one - and the ring is the shield, so this IS the
     shield coming off */
  F.broken = []; for (var i=0;i<SEGS;i++) F.broken.push(i);
  /* THE MOVE ON THE TABLE IS CANCELLED OUTRIGHT. A beam mid-burn or a shower
     mid-sweep would otherwise carry straight across the pulse that is supposed
     to have wiped the room, which reads as the pulse not working. */
  F.move = null; F.next = F.t + PULSE_GRACE; moveIx = 0;
  shots = []; sparks = []; patHush();
  kick(2.2, 1.15, "255,220,180"); knock(1600, 520, 0.55, 0.42);
  burst(W.x, W.y, 260, 1400);
  shocks.push({ x:W.x, y:W.y, r:Math.max(VW(),VH())*1.15, t:0, ms:PULSE_GRACE });
  voicePlay("whatdidyousay", true);
}

/* ════════════════════ AND HE PUTS IT BACK ON ════════════════════
   Reaching the gate does not kill him, it ends the break: the ring reforms,
   the tiles you own go dark, and the rotation starts again from the top. You
   KEEP the tiles - they light again for free the next time the shield drops -
   so the staircase is a ratchet and the only thing a main phase costs is the
   next ten seconds of standing still. */
function restoreShield(){
  F.brk = 0;
  /* ════════════════════ PARTIAL CHARGE DOES NOT SURVIVE THE PULSE ════════════════════
     A tile you own goes dark and keeps its place; a tile you were part-way
     through goes back to nothing. Left running, the seconds you banked in one
     main phase carried into the next one and the tile after the first was
     cheaper than the first - the ten seconds is meant to be paid in one
     stretch, under fire, or not at all. */
  for (var i=0;i<pads.length;i++){
    pads[i].on = false;
    if (!pads[i].won) pads[i].t = 0;
  }
  F.broken = [];                    /* whole again - see fightStart */
  /* ════════════════════ THE SHIELD COMES BACK AND THE TRIANGLE IS ALREADY COMING ════════════════════
     Coming out of a break used to hand you a clean floor and a rotation that
     opened on the runes, which is the most forgiving thing he does - so the
     first seconds of every main phase were free tile time. moveIx = 1 puts the
     SHOWER first instead: you get the pulse, then a wedge to be inside, and the
     charge has to wait for it. The tile is still there; it is just not free. */
  F.move = null; F.next = F.t + PULSE_GRACE; moveIx = 1; F.mvN = 0; F.brkPost = null;
  shots = []; sparks = []; patHush();
  kick(1.6, 0.8, "150,190,255"); knock(1200, 400, 0.45, 0.34);
  voicePlay("irrelevant", true);
}

var CLEAR_R = 300;

/* ══════════════════════ BOMBS, AND WHY THERE ARE THREE ═════════════════════
   Up to now the only thing that ever cleared the screen was BEING HIT, which
   means the only way out of a bad spot was to lose a quarter of your health
   getting there. That is the wrong shape: a bullet hell gives the player a
   panic button they choose to spend, and spending it is a decision rather than
   a punishment.

   SHIFT, because taking the fireblast out left that key with nothing to do.
   Three of them, a big clear, and a full second of invulnerability — long
   enough to walk out of whatever you bombed rather than being dropped straight
   back into it. They do not come back, so the question the fight asks at the
   end is "did you save one". */
/* ════════════════════ ONE BOMB, AND A TILE GIVES IT BACK ════════════════════
   Three was a stock of panic buttons you spent down over a fight. One is a
   DECISION: the only clear-the-room you have, and the only way to get another
   is to go and stand on a tile for thirteen and a half seconds under fire. That
   makes the bomb and the tile the same economy rather than two separate ones -
   spending it is what sends you to the next tile, and taking the tile is what
   pays for the next spend. */
/* {B} ONE BOMB PER TILE YOU HAVE TAKEN {B}
   The cap IS the tile count: no tiles, no bomb; four tiles, four. So the panic
   button is not a resource you are issued, it is a thing the fight pays you for
   the most dangerous work in it - and by break 4 you are holding four of them
   going into the phase that needs them.

   REFILLED TO FULL EVERY TIME, not incremented. Taking a tile with two already
   in hand still leaves you topped up rather than punished for saving them.

   THE OPENING HAS NO BOMB AT ALL, which is the deliberate cost of this: the
   first tile is charged with nothing to fall back on. */
var BOMB_START = 0, BOMB_R = 520, BOMB_IFRAME = 1000, BOMB_COOL = 600;
/* ════════════════════ EXACTLY ONE IN THE LAST PHASE ════════════════════
   Four tiles taken is four mines held, and a mine deletes every shot within
   520px - four of those turn the finale into a phase you can ignore. Zero was
   the other extreme and made the closing seconds, with three sets of pulses and
   the patterns still firing into a pocket barely a player wide, a matter of
   luck.

   One is the interesting number. It is not enough to skip the phase with and it
   is exactly enough to survive one moment that would otherwise be unsurvivable,
   which makes WHEN to spend it the last decision the fight asks for. finBegin()
   runs BEFORE breakShield's `F.bombs = bombMax()`, so the fourth tile pays out
   this one rather than the four it would otherwise. */
function bombMax(){ return F.fin ? 1 : (F.won|0); }

/* ═══════════════════════ THE REWIND ════════════════════════════════════════
   He does not die. At zero health the name on the bar becomes THETIMEWALKER,
   your controls lock, and the entire fight runs BACKWARDS at speed until it is
   the moment you walked in — five minutes undone in about twenty seconds, with
   you watching your own dodges play in reverse.

   WHAT IS RECORDED AND WHAT IS NOT, because that distinction is the whole
   reason this is affordable. A tape of every bullet would be two hundred
   objects times five numbers times five minutes: tens of megabytes, allocated
   during a bullet hell, which is exactly when the garbage collector must not be
   asked for anything.

   So the tape holds ACTORS ONLY — you, him, his ring, the tiles, the bars —
   eleven numbers a frame at 30fps. Five minutes is nine thousand frames and
   under a megabyte, recorded into a preallocated flat array with no per-frame
   objects at all.

   THE BULLETS ARE NOT REPLAYED, THEY ARE REVERSED. Every projectile on screen
   simply has its velocity negated and flies back the way it came, into him.
   That is free, it is frame-rate independent, and it looks more like time
   running backwards than a replay would — because it IS time running backwards
   for those objects, rather than a recording of it.

   THE TAPE IS SAMPLED, NOT PLAYED. Rewind time runs backwards through it at
   REWIND_RATE and the two nearest frames are interpolated, so the speed is a
   dial rather than a property of how it was recorded. */
var REWIND_FPS = 30, REWIND_RATE = 14, TAPE_FIELDS = 11;
var TAPE_MAX = REWIND_FPS * 400;                  /* 400s of headroom */
var tape = new Float32Array(TAPE_MAX * TAPE_FIELDS);
var tapeLen = 0, tapeAt = 0;
var rewinding = false, rewindPos = 0;

function tapeReset(){ tapeLen = 0; tapeAt = 0; }
function tapeRecord(now){
  if (rewinding || tapeLen >= TAPE_MAX) return;
  if (now - tapeAt < 1000/REWIND_FPS) return;
  tapeAt = now;
  var o = tapeLen * TAPE_FIELDS;
  tape[o  ] = P.x;      tape[o+1] = P.y;
  tape[o+2] = W.x;      tape[o+3] = W.y;
  tape[o+4] = W.ang;    tape[o+5] = W.scale;
  tape[o+6] = F.hpM;
  tape[o+7] = padsActive();
  tape[o+8] = F.aoeGlow;
  tape[o+9] = F.runeHeat;
  tape[o+10]= F.bombs;
  tapeLen++;
}

/* HE IS NOT DEAD, HE IS REWINDING. Called instead of the death, so nothing else
   in the fight has to know the difference. */
function startRewind(){
  if (rewinding) return;
  rewinding = true;
  rewindPos = tapeLen - 1;
  BOSS_NAME = "TheTimeWalker";
  F.move = null; F.station = null;
  clearKeys();
  /* every projectile turns round — see the note above */
  for (var i=0;i<shots.length;i++){ shots[i].vx = -shots[i].vx; shots[i].vy = -shots[i].vy; }
  for (var j=0;j<sparks.length;j++){ sparks[j].vx = -sparks[j].vx; sparks[j].vy = -sparks[j].vy; }
  kick(1.8, 0.95, "150,210,255");
  knock(90, 900, 1.2, 0.30);          /* a rising tone: the one sound that runs backwards */
}

function stepRewind(dt){
  rewindPos -= dt * REWIND_FPS * REWIND_RATE;
  if (rewindPos <= 0){
    rewindPos = 0;
    rewindDone();
    return;
  }
  var i0 = Math.floor(rewindPos), i1 = Math.min(tapeLen-1, i0+1), u = rewindPos - i0;
  var a = i0*TAPE_FIELDS, b = i1*TAPE_FIELDS;
  function L(k){ return tape[a+k] + (tape[b+k]-tape[a+k])*u; }
  P.x = L(0); P.y = L(1); P.vx = 0; P.vy = 0;
  W.x = L(2); W.y = L(3); W.ang = L(4); W.scale = L(5);
  F.hpM = L(6);
  F.aoeGlow = L(8); F.runeHeat = L(9);
  F.bombs = Math.round(L(10));
  /* the bar refills as it unwinds — his health is the one thing that is not on
     the tape, because it is a straight function of how far back we are */
  /* HIS BAR REFILLS AS IT UNWINDS - the one thing not on the tape, because it
     is a straight function of how far back we are. With the shield a switch
     rather than a pool there is only this one number to walk, and the ring
     closes over the same interval so the two always agree. */
  var f = tapeLen ? (1 - rewindPos/tapeLen) : 0;
  F.hpW = F.hpWmax * f;
  var gone = Math.round((1-f) * SEGS);
  F.broken = [];
  for (var q=0;q<gone;q++) F.broken.push(q);
}

/* AT THE END OF THE TAPE IT IS THE MOMENT YOU ARRIVED. Everything that happened
   has been taken back, including his shield — so the fight simply starts again,
   under a different name. Whether that is a second phase, a loop, or a scripted
   beat is a decision the fight has not made yet; the capability is what was
   asked for. */
function rewindDone(){
  rewinding = false;
  tapeReset();
  var keepName = BOSS_NAME;
  fightStart();
  BOSS_NAME = keepName;
  F.over = null;
  kick(1.4, 0.8, "255,220,180");
}

function useBomb(now){
  if (!F.on || F.over || !P.live || rewinding) return;
  if (F.bombs <= 0 || now - F.bombAt < BOMB_COOL) return;
  F.bombs--; F.bombAt = now;
  var m = pC(), i;
  for (i=shots.length-1;i>=0;i--)
    if (Math.hypot(shots[i].x-m.x, shots[i].y-m.y) < BOMB_R) shots.splice(i,1);
  F.iframe = Math.max(F.iframe, BOMB_IFRAME);
  shocks.push({ x:m.x, y:m.y, t:0, ms:760, r:BOMB_R });
  burst(m.x, m.y, 220, 900);
  kick(1.4, 0.75, "150,210,255");
  knock(150, 38, 0.6, 0.34);
}
function playerBlast(){
  var m = pC(), i;
  for (i=shots.length-1;i>=0;i--){
    if (Math.hypot(shots[i].x-m.x, shots[i].y-m.y) < CLEAR_R) shots.splice(i,1);
  }
  /* and it is drawn: a ring that sweeps out to exactly the radius it cleared,
     so what just happened is legible rather than merely merciful */
  /* ════════════════════ THE WAVE, AND NOTHING ELSE ════════════════════
     There were seventy sparks thrown out at 620px/s on top of the ring, and in
     an arena where every hostile thing is a small fast bright object, spraying
     seventy of them out of the player at the exact moment they were hit is the
     worst possible read: for a quarter of a second you cannot tell your own
     damage effect from the attack that caused it. The ring alone says the same
     thing - it sweeps to exactly the radius it cleared - and says it without
     adding forty new things to look at. */
  shocks.push({ x:m.x, y:m.y, t:0, ms:560, r:CLEAR_R });
  knock(120, 34, 0.5, 0.32);
}
var shocks = [];
function stepShocks(dt){
  for (var i=shocks.length-1;i>=0;i--){
    shocks[i].t += dt*1000;
    if (shocks[i].t >= shocks[i].ms) shocks.splice(i,1);
  }
}
/* ════════════════════ A PRESSURE WAVE, NOT TWO RINGS ════════════════════
   It was a 7px stroke with an 18px stroke behind it: two hard-edged bands of
   flat colour, both fading at the same rate, which is why it read as a drawn
   circle rather than as something travelling. A wave has a soft body that
   trails BEHIND its front and a front that stays crisp while the body thins.

   So: a radial gradient whose band narrows as it expands, drawn additively so
   it behaves like light, and one bright hairline exactly on the leading edge.
   The edge fades on a steeper curve than the body, so late in its life what is
   left is a soft breath of colour rather than a grey hoop. */
function drawShocks(c){
  c.save();
  c.globalCompositeOperation = "lighter";
  for (var i=0;i<shocks.length;i++){
    var k=shocks[i], p=Math.min(1,k.t/k.ms), e=1-Math.pow(1-p,3);
    var r=k.r*e, w=Math.max(3, k.r*0.20*(1-p*0.85));
    var hue=k.hue||"255,235,205", hue2=k.hue2||"255,150,90";
    if (r<=1) continue;
    var g=c.createRadialGradient(k.x,k.y,Math.max(0,r-w), k.x,k.y, r+w*0.30);
    g.addColorStop(0,   "rgba("+hue2+",0)");
    g.addColorStop(0.62,"rgba("+hue2+","+(0.20*(1-p)).toFixed(3)+")");
    g.addColorStop(0.92,"rgba("+hue +","+(0.34*(1-p)).toFixed(3)+")");
    g.addColorStop(1,   "rgba("+hue +",0)");
    c.fillStyle=g;
    c.beginPath(); c.arc(k.x,k.y,r+w*0.30,0,6.28318); c.fill();
    /* the front */
    c.strokeStyle="rgba(255,255,255,"+(0.80*Math.pow(1-p,1.6)).toFixed(3)+")";
    c.lineWidth=Math.max(1, 2.6*(1-p*0.6));
    c.beginPath(); c.arc(k.x,k.y,r,0,6.28318); c.stroke();
  }
  c.restore();
}
/* ════════════════════ HE IS ONLY HITTABLE WITH THE SHIELD OFF ════════════════════
   There is no chipping through it any more and no random segment to pop. The
   shield is either on, in which case this does nothing at all, or off, in
   which case every point goes into the one pool.

   THE BREAK ENDS ON THE GATE, NOT ON A CLOCK. A timer would have made a bigger
   bet buy a bigger number on a bar that still took the same thirty seconds;
   this way the damage you brought is what decides how long you have to survive
   for, which is the whole reason the tiles are a staircase. */
/* {B} THE BAR MOVES; NOTHING SAYS BY HOW MUCH {B}
   Four tiles feeding a stone that fires a line into him, a bar creeping left,
   and no number anywhere - so the difference between one tile and four is
   something you infer from how bored you are. The damage is accumulated and
   thrown off the point of contact roughly four times a second, because a
   number per frame at 205 dps is a smear rather than a readout.

   They rise, drift toward the arena so they clear his art, and fade. Purely
   cosmetic: nothing here is read back by anything. */
var dmgNums = [], dmgAcc = 0, dmgAt = 0;
var DMG_EVERY = 260;
/* {B} SAY WHAT THE TILE JUST PAID {B}
   Thirteen and a half seconds standing still under fire buys a bomb and a third
   of your health, and the only sign of it was two small numbers changing in a
   readout at the bottom of the screen while the room exploded. It is the single
   biggest reward in the fight and it needs to be announced where the player is
   actually looking - which is the middle, because that is where the pulse just
   went off. */
var lootMsg = null;
function lootShow(n){
  lootMsg = { t:0, ttl:1700, n:n };
}
function lootStep(dt){
  if (!lootMsg) return;
  lootMsg.t += dt*1000;
  if (lootMsg.t >= lootMsg.ttl) lootMsg = null;
}
function lootDraw(c){
  if (!lootMsg) return;
  var p = lootMsg.t/lootMsg.ttl;
  var a = p < 0.14 ? (p/0.14) : (1 - Math.pow((p-0.14)/0.86, 2.4));
  var rise = 26*Math.pow(p, 0.6);
  var cx = VW()*PLAY_MAX_X*0.5, cy = VH()*0.34 - rise;
  c.save();
  c.textAlign="center"; c.textBaseline="middle";
  c.lineJoin="round"; c.miterLimit=2;
  c.font = '700 34px ui-monospace,Consolas,monospace';
  c.strokeStyle = "rgba(4,10,16,"+(0.9*a).toFixed(3)+")"; c.lineWidth = 7;
  var msg = "+" + lootMsg.n + (lootMsg.n===1 ? " MINE" : " MINES");
  c.strokeText(msg, cx, cy);
  c.fillStyle = "rgba(140,214,255,"+a.toFixed(3)+")";
  c.fillText(msg, cx, cy);
  c.font = '700 15px ui-monospace,Consolas,monospace';
  c.strokeStyle = "rgba(4,10,16,"+(0.9*a).toFixed(3)+")"; c.lineWidth = 5;
  c.strokeText("SHIFT", cx, cy+26);
  c.fillStyle = "rgba(190,235,255,"+(0.85*a).toFixed(3)+")";
  c.fillText("SHIFT", cx, cy+26);
  c.restore();
  c.textBaseline="alphabetic";
}

function dmgNumStep(dt){
  for (var i=dmgNums.length-1; i>=0; i--){
    var d=dmgNums[i];
    d.t += dt*1000;
    if (d.t >= d.ttl){ dmgNums.splice(i,1); continue; }
    d.x += d.vx*dt; d.y += d.vy*dt; d.vy += 26*dt;
  }
}
function dmgNumDraw(c){
  if (!dmgNums.length) return;
  c.save();
  c.textAlign="center"; c.textBaseline="middle";
  c.lineJoin="round"; c.miterLimit=2;
  for (var i=0;i<dmgNums.length;i++){
    var d=dmgNums[i], p=d.t/d.ttl, a=(1-p*p);
    c.font="700 "+d.sz.toFixed(0)+"px ui-monospace,Consolas,monospace";
    c.strokeStyle="rgba(6,4,14,"+(0.88*a).toFixed(3)+")"; c.lineWidth=4;
    c.strokeText(d.txt, d.x, d.y);
    c.fillStyle="rgba(255,236,190,"+a.toFixed(3)+")";
    c.fillText(d.txt, d.x, d.y);
  }
  c.restore();
  c.textBaseline="alphabetic";
}
function dmgNumPush(v){
  if (dmgNums.length > 26) return;
  var p = F.hitPt || { x:W.x, y:W.y };
  var jx = (Math.random()-0.5)*38, jy = (Math.random()-0.5)*30;
  dmgNums.push({ x:p.x+jx, y:p.y+jy, vx:-58-Math.random()*40, vy:-78-Math.random()*36,
                 t:0, ttl:900, sz:16+Math.min(12, v/34), txt:String(Math.round(v)) });
}

function hitWalker(n){
  if (!F.on || F.over || !F.brk || rewinding) return;
  F.hpW = Math.max(0, F.hpW - n);
  /* banked and thrown off in readable lumps rather than per frame */
  dmgAcc += n;
  if (F.t - dmgAt >= DMG_EVERY){ dmgAt = F.t; if (dmgAcc >= 1) dmgNumPush(dmgAcc); dmgAcc = 0; }
  /* THE REWIND IS KEPT, NOT DELETED. startRewind() and its tape are intact and
     still correct; nothing calls them for now. Putting the old ending back is
     this one line. */
  if (F.hpW <= 0){ finCollapse(); return; }
  if (F.hpW/F.hpWmax <= GATE[F.brk]) restoreShield();
}

/* THE SET LIST. Read straight through and looped, with nothing conditional left
   in it — the charge was the one move that unlocked partway through, and taking
   it out took the last branch with it. */
/* HE DOES NOT OPEN WITH THE AOE. It was the first thing in the list and it
   fired 1.1 seconds in — a full-arena wall of sparks with one door in it,
   arriving before the player has worked out which shape on the screen is them.
   Unavoidable is not the same as hard, and the first thing a boss does is the
   thing that teaches you how to read him.

   So the opening is the RUNES: a line drawn across the arena a full 1.8s before
   it burns, which is the most legible thing he does. The AOE lands second, by
   which time the arena has introduced itself. */
/* THREE MOVES, THREE DIFFERENT QUESTIONS, ALTERNATING SO NO TWO OF A KIND EVER
   FOLLOW EACH OTHER:
     runes  which side of a line are you on
     aoe    find the one safe sector, and keep up with it as it turns
     nova   there is no safe sector — run for a corner
   The fireblast is gone: a single slow ball aimed at you is the least
   interesting thing a bullet hell can do, and it was the only reason the sword
   existed. The charge is gone too — it was the only reason he ever left the
   ceiling, which the nova now does with a point. */
var MOVE_SCRIPT = ["runes", "aoe", "nova", "runes", "aoe", "nova"];
/* ════════ WHAT HE STILL HAS WHILE THE SHIELD IS OFF ══════════════════════
   A break phase is the bullet hell, and he gives up the big moves to run it -
   then takes them back one at a time as you take the tiles.

     break 1   nothing         just the patterns, and the floor is yours
     break 2   runes           a line you are on one side of
     break 3   runes, shower   and a wedge you are not allowed to leave
     break 4   runes, shower   plus the counter-arm, plus 15%

   THE NOVA NEVER COMES BACK. It is the one move whose answer is "be somewhere
   else entirely" - a measured 1.60-1.78s run against 2.08s of warning - and
   there is no crossing this arena through a bullet hell in the 0.3s of slack
   that leaves. In the main phase, with the patterns suppressed, it is a fair
   question. Here it would be a dice roll. */
var BREAK_MOVES = [
  null,                        /* 0 is the main phase, which uses MOVE_SCRIPT */
  [],
  ["runes"],
  ["runes", "aoe"],
  ["runes", "aoe"]
];
var moveIx = 0;
function moveSet(){ return F.brk ? BREAK_MOVES[F.brk] : MOVE_SCRIPT; }
function pickMove(){
  var s = moveSet();
  return (s && s.length) ? s[moveIx++ % s.length] : null;
}

/* ══════════════════════════ HE LIVES AT THE TOP ════════════════════════════
   He was picking corners, including the two at the BOTTOM — which put him on
   top of the player, threw half his shower off the edge of the screen, and left
   him clipped by the top-right corner with nowhere to retreat to. A boss in a
   bullet hell belongs on one edge, with the whole arena in front of him: it
   makes the screen readable, it gives the bullets room to travel, and it means
   "away from him" is always a real direction.

   AND HE NEVER LEAVES IT. The charge was the one move that brought him down
   into the arena, and it is gone — so the ceiling is not a default position any
   more, it is the whole of where he is. Everything he throws now comes from
   above, which makes "away from him" mean the same thing for the entire fight
   rather than being reversed once per cycle. */
/* ═════════════ TWO SIDES, AND NEITHER OF YOU LEAVES YOURS ══════════════════
   He owns the right of the arena and you own the left, with a hard wall between
   you. This replaced him roaming the ceiling, and the reason is not tidiness —
   it is that a boss who moves to an arbitrary new post every two seconds gives
   the player nothing to learn. Every angle changed constantly, so no bullet
   pattern ever arrived from a direction you could anticipate, and the answer to
   each one was different every time it appeared.

   PINNED TO ONE SIDE, EVERYTHING GETS A FIXED BEARING. His shots come from the
   right; the rune beams sweep right-to-left; the gap in his ring opens across
   the arena toward you rather than in whatever direction he happens to be
   facing. The fight becomes readable because the geometry stops moving.

   HE STILL MOVES — vertically, along his own wall, so the aimed patterns have
   somewhere to come from and the arena is not static. What he no longer does is
   change which half of the screen he is in.

   THE ONE EXCEPTION IS THE NOVA, and it earns it: crossing into the middle is
   the only time he leaves his side all fight, which is what makes that attack
   feel like an event rather than another pattern. */
/* THE SPLIT IS GONE ENTIRELY — no clamp, no line, no constant. He still holds
   the right of the arena because that is where he stands; nothing stops you
   walking into it, and nothing draws a border to say so. */

/* HIS POSTS ARE A FIXED VERTICAL WALK on a fixed column. Same list every run,
   so "he is about to be high" is a thing you can know. */
var STATION_Y = [0.30, 0.62, 0.42, 0.74, 0.34, 0.66, 0.24, 0.54];

/* ═══════════════════ THE FIGHT IS THE SAME EVERY TIME ══════════════════════
   Move order, the posts he takes along the ceiling, which way the door in his
   ring opens, the phase of every ring — all of it comes off a fixed list rather
   than a random one. A boss you can only beat by luck is a boss you cannot
   LEARN, and everything interesting about this fight is learnable: which gap to
   run for, which side of the rune line to be on, where he will be standing when
   the ring goes off. Randomness here would hide all of that behind variance.

   WHAT STAYS RANDOM IS ONLY WHAT YOU CANNOT PLAY AGAINST: the exact angle of an
   individual spark, the tumble on a shard leaving the board. Nothing that
   changes where you should be standing. */
/* ════════════════════ THE BEAM DID NOT LIVE IN THE BOTTOM THIRD BY DESIGN ════════════════════
   It shared stationIx with his patrol, and the patrol eats entries between
   moves - so an eight-entry table aliased against the move cadence and settled
   into a four-value cycle in break 2 (.62 .74 .66 .54) and a two-value one in
   break 4 (.74 .54). Every one of those is the lower half of the screen, which
   is why it read as the same place every time.

   Three bands, chosen at random, never the same one twice running. This is a
   deliberate exception to the no-randomness rule at the top of this file: the
   rule protects things you PLAY AGAINST, and where the beam will be is not one
   of them - you are shown the line for a full 1.8s before it burns, so the
   answer is read off the screen rather than remembered. What the fixed table
   was actually buying was a third of the arena never being used. */
var RUNE_BANDS = [0.18, 0.50, 0.82], runeBand = -1;
function runeStation(){
  var i;
  do { i = Math.random()*RUNE_BANDS.length | 0; } while (i === runeBand);
  runeBand = i;
  return { x: VW()*0.76, y: VH()*RUNE_BANDS[i] };
}

/* the fight's own context, stashed so a helper drawn outside the main loop can
   reach it without threading it through every call */
var FX = null;
var stationIx = 0;
function topStation(){
  var f = STATION_Y[stationIx++ % STATION_Y.length];
  return { x: VW()*0.76, y: VH()*f };   /* moved left a little */
}
/* ═══════════ EQUAL-LENGTH BREAKS, NOT EQUAL-SIZED BITES ═══════════════════
   padDPS() is superlinear - x1, x2.6, x4.8, x7.6 at one to four tiles - so
   four flat 25% gates would run the first break 7.6 times longer than the
   last, and the finale would be over before the arms had finished filling the
   screen. Each break's bite is proportional to the rate that eats it, so all
   four take the same time: mult/16 of the pool.

     break 1   x1.0    6.3%   ends at 93.8%
     break 2   x2.6   16.3%   ends at 77.5%
     break 3   x4.8   30.0%   ends at 47.5%
     break 4   x7.6   47.5%   ends at 0

   DERIVED, NOT TYPED, so the two can never drift apart: change the damage
   curve and the gates follow it on their own. */
function tileMult(k){ return k ? k * (1 + 0.30*(k-1)) : 0; }
var MULT_SUM = (function(){ var s=0; for (var i=1;i<=PAD_FORCE;i++) s+=tileMult(i); return s; })();
var GATE = (function(){
  var g = [1], left = 1, i;
  for (i=1;i<=PAD_FORCE;i++){ left -= tileMult(i)/MULT_SUM; g[i] = Math.max(0, left); }
  return g;                    /* GATE[k] = the health fraction break k ends at */
})();

/* ════════════════════ A BREAK IS A LENGTH OF TIME, NOT A LUMP OF HEALTH ════════════════════
   His pool was a constant 6000 while padPower runs from 9.8 at the opening bet
   to 125 at the cap - so the same lump evaporated at wildly different speeds
   and the fight was 38 seconds a break for one player and 3 for another. A
   boss whose length is set by your shop is not a boss.

   So the duration is the number that is chosen, and the POOL is derived from
   it. Each break wants T seconds, its rate is padPower x tileMult(k), so:

       pool = padPower x T x MULT_SUM

   and every break then takes pool / (MULT_SUM x padPower) = T EXACTLY,
   whatever padPower happens to be. The bet cancels out of the arithmetic
   completely, which is the point - it stops being able to trivialise this.

   THIRTY SECONDS, LESS ONE PER BET UPGRADE. What a bigger bet buys here is a
   SHORTER fight rather than a shorter-feeling one: the same eight phases, run
   faster, because a player deep in the ladder has done this before.

   THIRTY SECONDS IS MEASURED AT AN $8 BET, which is betSize level 36 - the
   point the whole fight is tuned for. The first version of this counted down
   from level 0 and handed the tuning point a 10-second break, which is the
   floor, i.e. exactly the bug it was written to fix. The countdown starts at
   the tuning point instead: level 36 is 30s, 37 is 29s, and a player who
   arrives under-levelled gets the same 30 rather than a longer one, because a
   sixty-second break is not a kindness.

   THE FLOOR IS NOT IN THE SPEC. The bet track is 118 levels, so something has
   to stop it going negative - it bottoms out at level 66 and holds. Ten
   seconds is roughly the shortest a break can be and still contain one shower,
   1.5s of burn on a 4.4s gap, and it is one constant to change. */
var BREAK_SECS = 30, BREAK_SECS_MIN = 10;
var BET_LVL_TUNED = 36;        /* $8.00 a draw - what this fight is built for */
function breakSeconds(){
  var lvl = 0;
  try { if (typeof S !== "undefined" && S && S.upgrades) lvl = S.upgrades.betSize|0; } catch(e){}
  return Math.max(BREAK_SECS_MIN, BREAK_SECS - Math.max(0, lvl - BET_LVL_TUNED));
}
/* read once, with padPower, so a purchase mid-fight cannot resize him */
function walkerPool(){ return Math.max(1, Math.round(F.padPower * breakSeconds() * MULT_SUM)); }

/* ═════════════ WHAT "PHASE" MEANS NOW, AND WHAT IT DOES NOT ═══════════════
   It used to be F.broken.length - how many shield segments were gone - and
   three separate things read it: the pattern gate, the interval tightening,
   and the ring's bullet count. The shield is a switch now, so that number is
   1 or 5 and nothing between; leaving those three on it would have stepped
   every one of them from minimum to maximum the instant the first tile lit,
   and back again when the shield returned.

   The escalation is the TILES instead. It only goes up, it moves once per
   break, and it is the same number the damage staircase uses - so he gets
   harder at exactly the rate you get stronger, which is the trade the tiles
   were always supposed to be offering. */
function esc(){ return F.won; }

/* ── the bullet patterns ────────────────────────────────────────────────────
   FOUR OF THEM, UNLOCKING AS YOU BREAK HIM, so the screen gets busier exactly
   as he gets weaker — the same inversion the spin already uses. Each one is a
   different SHAPE of problem rather than more of the same one:

     aimed   a single bullet where you are      — punishes standing still
     fan     five in a spread at you            — punishes small dodges
     ring    twenty-four, radial, ignoring you  — punishes standing anywhere
     spiral  a continuous rotating arm          — punishes standing STILL again,
                                                  but only relative to the arm
   The ring is the only one that is not aimed, which is what makes it the one
   that forces movement rather than merely rewarding it. */
/* NO TWO THE SAME COLOUR, BUT STILL FOUR READABLE FAMILIES. A pattern has to
   stay identifiable — you learn "the magenta ones come in a ring" — so the
   variation is a walk AROUND each family's colour rather than a free choice.
   Deterministic off the bullet index, because the fight is scripted and a roll
   here would put a different sky on every run. */
function varyHue(base, i){
  var p2 = base.split(","), k = (i*0.6180339887) % 1;
  var lift = [ (k-0.5)*54, (((i*0.3819)%1)-0.5)*54, ((((i*0.7549)%1))-0.5)*54 ];
  return [
    Math.max(28, Math.min(255, (+p2[0]) + lift[0])) | 0,
    Math.max(28, Math.min(255, (+p2[1]) + lift[1])) | 0,
    Math.max(28, Math.min(255, (+p2[2]) + lift[2])) | 0
  ].join(",");
}

function bullet(a, speed, r, hue){
  var R=walkerR();
  /* ══════ THE SPEED BUFF LIVES HERE, AND NOWHERE ELSE ══════════════════════
     Every bullet pattern and the nova's creeping galaxies come through this
     one function. The spark shower does not - it has its own emitter - and
     that is exactly the split the buff wants. Sparks are drag-limited, so
     their REACH is v0/-ln(drag): scaling their v0 would not make the shower
     faster, it would move the far wall that the wedge, the 66% play bound and
     the whole "it just reaches the corner" tuning are measured against.
     Bullets have no drag. They simply arrive sooner. */
  speed *= F.spd;
  shots.push({ x:W.x+Math.cos(a)*R, y:W.y+Math.sin(a)*R,
               vx:Math.cos(a)*speed, vy:Math.sin(a)*speed,
               r:(r||9), hue:varyHue(hue||"150,110,255", galIx),
               /* every galaxy turns, and they do not all turn together — the
                  index gives each one its own phase and rate without a roll */
               rot:(galIx*0.83)%6.28318,
               rotV:(galIx%2?1:-1)*(1.1+((galIx*0.37)%0.9)),
               /* EVERY ONE IS TILTED DIFFERENTLY, which is the single biggest
                  thing the reference had and the first pass did not: uniform
                  squash makes a field of identical lozenges, and varying it
                  from nearly edge-on to nearly face-on is what turns them into
                  a scattering of separate objects. */
               sq: 0.30 + ((galIx*0.6180339887)%1)*0.58,
               sz: 0.86 + ((galIx*0.3819)%1)*0.42 });
  galIx++;
}
/* HOW FAR THE ARENA IS IN THIS DIRECTION. "Three quarters of the way to the
   edge" is not one radius — he stands near a corner, so a circle of fixed
   radius round him is mostly OFF the arena. Measured with a 666px ring, 32 of
   40 bullets landed outside and the wall was 8 bullets of noise.

   Per bearing, this is the distance from him to the boundary of the space the
   player is allowed to occupy, so 0.75 of it is genuinely three quarters of the
   way out in every direction and the whole ring lands where it can be hit. */
function edgeDist(a){
  var cx=Math.cos(a), cy=Math.sin(a), best=1e9, maxX=VW()*PLAY_MAX_X;
  if (cx >  1e-6) best=Math.min(best,(maxX - W.x)/cx);
  if (cx < -1e-6) best=Math.min(best,(0    - W.x)/cx);
  if (cy >  1e-6) best=Math.min(best,(VH() - W.y)/cy);
  if (cy < -1e-6) best=Math.min(best,(0    - W.y)/cy);
  return best;
}

/* the same bullet, born anywhere and pointed anywhere - bullet() ties the two
   together because everything else he throws leaves his rim outward, and these
   do the opposite: they come in from the walls */
function bulletFrom(x, y, ang, speed, r, hue){
  var n = shots.length;
  bullet(ang, speed, r, hue);
  if (shots.length > n){ var b = shots[shots.length-1]; b.x = x; b.y = y; }
}
function aimAtPlayer(){ var m=pC(); return Math.atan2(m.y-W.y, m.x-W.x); }

/* ════════════════════ THE AIMED PAIR NEEDED THEIR OWN SPEED ════════════════════
   Both of these lead you, and at this range the lead was the whole problem.
   The tile arc sits 884px from him - 745px of travel once it leaves his rim -
   so at 155px/s a shot arrives 4.8 SECONDS after it was fired, aimed at where
   you stood then. Against a 430px/s player that is not a lead, it is a
   different room. Measured on the opening: about one bullet a second came
   within 120px of a player standing on a tile for the whole ten-second charge.

   300 puts the lead at 2.5s, which is short enough that "aimed" means
   something again and still SLOWER THAN THE PLAYER - you can always outrun it,
   the arena stays navigable, and it is nowhere near the flinch band.

   IT IS ITS OWN CONSTANT BECAUSE SHOT_SPEED IS NOT ONLY THIS. The ring, the
   spiral and the counter-arm are all derived from SHOT_SPEED, and they are the
   drifting texture the fight is built on - speeding those up is a different
   change and not the one that was asked for.

   Three bands now, which is the shape this always wanted:
     105-124   the arms and the ring   drift, you route through them
     300-331   aimed and fan           press, you cannot stand still
     (nothing) the fast band is empty  - see patSnipe's note */
/* ════════════════════ ONE PLACE FOR EVERY NUMBER WORTH ARGUING ABOUT ════════════════════
   These were scattered as literals and as multiples of SHOT_SPEED, which made
   "make the fan a bit slower" a code change and a redeploy every time. They are
   absolute px/s now, in one object, and the dev panel writes straight into it -
   press ` in the arena, drag, watch. Whatever you settle on, read the numbers
   off the panel and they get baked in here.

   THE FAN IS BACK AT 143. The 20% it was given when the rows were capped, on
   top of the aimed pair moving to 300, took it to 331 and that was much too
   much - so it is at the value it had for the whole life of the fight before
   today, and the slider is there to find the real answer.

   Three bands, and they still mean different things:
     105-143   arms, ring, fan   drift, you route through them
     300       aimed             presses, you cannot stand still
     (none)    fast band removed */
var TUNE = {
  /* ════════════════════ SPACING IS SPEED TIMES INTERVAL ════════════════════
     The complaint was that the aimed stream arrives as a line with no room in
     it, and there are two ways to open that up: make each round weave off its
     own bearing, and put more GROUND between consecutive rounds. Both are here
     and both are on the panel, because which one does the work is a matter of
     taste and one slider settles it.

       spacing = aimed x (aimEvery/1000)
       300 x 0.23 =  69px   <- what it was. Take off 18px of round and 9px of
                               player and 42px of it is actually yours, which
                               is not a gap you navigate, it is one you survive
       200 x 0.70 = 140px   <- now, and slower, so it reads on the way in

     BEWARE THE TIGHTENING. Every interval is divided by 1 + 0.18*(ph - from),
     so by break 4 this gap is 94px rather than 140 - the escalation eats it
     back. If "always" turns out to mean the late breaks too, the aimed row is
     the one to lift out of that divisor.

     Slower also lengthens the lead again - 762px at 200px/s is 3.8s - which is
     the trade: you see it coming from further out, and it is aimed at somewhere
     you were longer ago. The weave is what keeps that from being free. */
  /* DIALLED IN ON THE PANEL, NOT DERIVED. 350 at a 700ms gap is 245px between
     rounds; the weave is left at 60 with its frequency at ZERO, which switches
     it off - sin(0*t + phase) is constant, and both starting phases give zero
     lateral. The spacing did the work and the weave was not needed. It stays in
     the code with its amplitude parked, so turning the Hz up is a drag rather
     than a rebuild. */
  aimed:350, aimEvery:700, aimWave:60, aimWaveHz:0,
  fan:110, fanW:460, fanRows:1,
  ring:170, spiral:170, counter:145, padCharge:13500, moveGap:0.75, novaOrbEvery:210, mainRush:1500, mainRest:3500,
  runeTell:1800, aoeTell:2600, novaTell:1800
};
/* ════════════════════ IT WAS A LINE, AND A LINE IS NOT A DODGE ════════════════════
   One round every 230ms, every one of them aimed at exactly where you are
   standing, all of them travelling dead straight: that is not a pattern, it is
   a hose. On a tile - where you have to stand still for ten seconds - it was
   a stream arriving down a single bearing with nothing to read and nowhere to
   be, which is the opposite of what "punishes standing still" is supposed to
   mean. It should cost you a step, not the charge.

   So each round leaves on the bearing it was aimed at and then WEAVES across
   it: a lateral velocity that swings sinusoidally about its own heading. The
   path is an S, the arrival point is offset from the aim point by up to
   wave/(2*pi*hz) - about 64px at the defaults - and consecutive rounds start
   half a cycle apart so the stream braids instead of snaking as one rope.

   The bearing is still AT you. What it is not any more is a ruler. */
var aimIx = 0;
function patAimed(){
  var a = aimAtPlayer(), n0 = shots.length;
  bullet(a, TUNE.aimed, 9);
  if (shots.length === n0) return;
  var b = shots[shots.length-1];
  /* the base speed is read back off the round rather than from TUNE, because
     bullet() has already applied the phase's speed multiplier to it */
  b.bs = Math.hypot(b.vx, b.vy);
  b.bx = Math.cos(a); b.by = Math.sin(a);
  b.wv = TUNE.aimWave;
  b.wf = TUNE.aimWaveHz * 6.28318;
  b.wp = (aimIx++ % 2) ? 3.14159 : 0;    /* alternate, so they braid */
  b.wt = 0;
}
/* ══════ THE FAN IS A WIDTH, NOT AN ANGLE ══════════════════════════════════
   A fixed 0.15 rad step means the spread grows with range, and the range is
   large - the player works the tiles most of a screen away from him. Seven
   bullets 0.15 apart is 0.90 rad total, which at 750px is a 650px wall with
   110px gaps in it. You step once into a gap and are then allowed to stop,
   which is the opposite of what this pattern is for.

   Defining it by the width it will have WHEN IT ARRIVES makes it the same
   threat at every range: FAN_W across, wherever you stand. The gaps are then
   narrow enough that drifting into one is not a plan - you have to keep
   moving, and because he sits to your right the spread is vertical, so moving
   means up and down the board.

   The middle bullet is aimed exactly at you, so standing perfectly still was
   never survivable and still is not. */
/* ════════════════════ ONE WALL AT A TIME, WIDE AND SLOW ════════════════════
   It went seven-bullets-every-800ms with eight rows stacked up, then three rows,
   and now one: a single wall in the air at any moment, 460px across instead of
   250 and slower than it has ever been. Seven bullets over 460px is 77px
   between centres against a 4.5px hitbox, so the gaps are genuinely walkable -
   which is what makes it a wall you READ rather than a rank you happen to be
   standing between. Width and row count are both on the panel. */
/* ════════════════════ THREE ROWS IN THE AIR, AND NO MORE ════════════════════
   A wave every 800ms against a six-second crossing put seven or eight rows on
   the floor at once - fifty-odd bullets in parallel ranks, which stops reading
   as a wall to step through and starts reading as weather. Three is the most
   that can be on screen; the fourth simply is not fired, and the pattern tries
   again on its next tick.

   TWENTY PERCENT FASTER TO PAY FOR IT. Fewer rows would mean less pressure at
   the same speed, so they cross quicker instead - the same question arriving
   sooner rather than a bigger pile of it arriving eventually. It also recycles
   the cap faster, since a row has to leave before the next one is allowed. */
var fanIx = 0;
function fanWavesLive(){
  var seen = {}, n = 0, i, w;
  for (i=0;i<shots.length;i++){
    w = shots[i].fanW;
    if (w !== undefined && seen[w] === undefined){ seen[w] = 1; n++; }
  }
  return n;
}
function patFan(){
  /* the timer has already been stamped by stepPatterns, so a blocked wave just
     means it asks again one interval later rather than the instant a row dies */
  if (fanWavesLive() >= TUNE.fanRows) return;
  var m=pC(), a0=Math.atan2(m.y-W.y, m.x-W.x);
  var d=Math.max(200, Math.hypot(m.x-W.x, m.y-W.y));
  var step=(TUNE.fanW/6)/d;       /* seven bullets, six gaps */
  var wave = fanIx++;
  for (var i=-3;i<=3;i++){
    var n0 = shots.length;
    bullet(a0 + i*step, TUNE.fan, 8);
    /* tagged so the cap counts ROWS rather than bullets - a row part-way off
       the screen still occupies its slot */
    if (shots.length > n0) shots[shots.length-1].fanW = wave;
  }
}
function patRing(){
  /* the ring gets denser too — 24 at first sight, 40 by the end */
  /* the ring's phase walks by a fixed step, so successive rings interleave
     instead of landing on top of each other — and it is the same walk on every
     run */
  var n = 24 + 4*Math.max(0, esc()-1), off = (ringIx++) * 0.41;
  for (var i=0;i<n;i++) bullet(off + i*6.28318/n, TUNE.ring, 8, "226,72,178");
}
/* WHERE THE DOOR OPENS, as fractions of the arena. All well inside the player's
   half (which ends at 0.60) and spread top-to-bottom so consecutive AOEs do not
   ask for the same corner twice. */
/* ══════════════ THE DOOR SWEEPS THE ARENA, IT DOES NOT SIT STILL ══════════
   Aimed at one point it left far too much of your half untouched: the sparks
   came out of four fifths of the ring, but the fifth that did not was a fixed
   corridor, so the same third of the arena was open for the whole shower and
   the attack asked nothing except "be over there".

   IT IS A SWEEP NOW. The door starts hard at one end of your half and travels
   to the other across the whole 1.5 seconds of the shower, so the safe space is
   never a place, it is a MOVING place — and where it ends up is announced
   before it starts, by which way the wheel turns:

     COUNTERCLOCKWISE   opens at the top and sweeps DOWN; the bottom of your
                        half is what is left standing at the end
     CLOCKWISE          opens at the bottom and sweeps UP; the top is left

   That is one bit of information, given for free by an animation the player is
   already watching, and it tells them which half of the arena to be drifting
   toward before the first spark lands. The two are exact mirrors of each other,
   which is what makes the pair learnable rather than two separate attacks.

   THE SWEEP IS SIZED TO THE PLAYER'S SPEED. It crosses 118 degrees in 1.5s,
   which at the 300px they stand out from him is 0.86 rad/s or about 260px/s of
   tangential travel — comfortably under the 430 they can run, so following it
   is work rather than a coin toss. */
/* ========== HE HAS TO LOOK LIKE HE IS SPINNING =============================
   2.06 radians over 1.5s is 0.22 turns a second - a wheel creeping round, not
   one throwing sparks off itself. The sweep and the spin are the SAME number,
   because the door is part of the ring, so making him spin means sweeping
   further.

   THE DOOR GETS WIDER TO PAY FOR IT. At 2.9 radians its edge moves about
   580px/s where the player stands, faster than the 430 they can run - a narrow
   door would simply outrun them. A 137-degree one does not have to be chased at
   its own speed; it is wide enough to drift inside. Faster AND more forgiving,
   which is the trade that lets him look like a wheel. */
/* ══ THE SAFE SPOT IS NOW THE SPOT THE TELEGRAPH POINTED AT ════════════════
   "the second AOE has a safe spot that is nowhere near the small value we told
   it to be. you are safe for like the upper 3/4 of the room."

   Both halves of that were true and they had the same cause. A 137-degree door
   is already a third of the circle, and he stands at the RIGHT EDGE of the
   arena, so a third of the circle aimed inward covers most of the arena's
   AREA. Then it swept 166 degrees on top, and because damage ticks for the
   whole shower rather than once, the union of everywhere-the-door-ever-was is
   what actually reads as safe — 137 + 166 = 303 degrees of it. The telegraph
   showed a wedge, the door immediately left it, and the low-damage region
   ended up being the upper three quarters.

   Measured on the real fight: a stationary player was NEVER-hit in 0-3% of the
   arena, but took only 2 ticks of 6 across that whole upper region against 6
   of 6 in the corner he was standing next to. That difference is what "safe"
   meant here.

   50 DEGREES, AND IT BARELY MOVES. The door is now a genuine wedge, it stays
   where the wind-up promised, and it drifts 26 degrees across the shower —
   enough that you cannot plant and stop thinking, nowhere near enough to
   outrun you (26 degrees over 1.4s is 130px/s at the distance you stand; you
   run 430).

   AND IT IS NO LONGER THE RING. The door used to BE a sector of his wheel, so
   its speed and the wheel's speed were the same number — which is why making
   him spin like a wheel had to make the door sweep like one too, and why it
   had to be enormous to stay dodgeable. They are separate now: the ring spins
   fast because it is throwing sparks, and the door is a corridor in the
   SHOWER that holds still because you were told where it would be. */
/* ══ 23 DEGREES, BECAUSE THE WEDGE POINTS ACROSS THE WHOLE ROOM ════════════
   50 degrees was sized for a door aimed at a corner right next to him. Aimed
   ACROSS the arena it is a completely different amount of floor: from where he
   stands, the whole reachable half of the room only spans about 88 degrees of
   bearing, so a 50 degree wedge is more than half of everywhere you are allowed
   to be. Measured, that is exactly what it was — 47% of the arena safe.

       50deg -> 47% safe      23deg -> 25%      13deg -> 17%
       32deg -> 33%           18deg -> 21%       9deg -> 12%

   23 gives a triangle that is a quarter of the room and still 163px across
   where the player actually stands, which is eighteen times their hitbox. */
/* ════════════════════ AND IT IS WIDER THAN IT WAS ════════════════════
   23 degrees was measured against the CROSSED geometry and looked reasonable
   there. It was still the tightest thing in the fight once the sliver above was
   fixed, so it goes to 32 - which on the same arena is 12.2% of the floor in a
   340 x 420 triangle, a third more ground than 23 gave. It is still a triangle
   you have to commit to during the wind-up; it is no longer one you have to
   thread. */
var DOOR_SPAN = SEG * 0.4444;      /* about 32 degrees */
/* ══ AND IT DOES NOT DRIFT AT ALL ══════════════════════════════════════════
   26 degrees of drift sounds harmless and is not, because THE CORRIDOR YOU SEE
   IS MADE OF OLD SPARKS. A spark 560px out left him about 0.4s ago and was
   aimed by the door as it stood THEN, so the gap drawn at that distance shows
   an older bearing than the one the damage test is using. The further out you
   stand the staler the picture, and the corridor visibly bends away from the
   band that is actually safe — which is exactly "the player is literally not
   inside it" even when the damage says they are.

   A door that does not move has no stale angle to show. The corridor is the
   same bearing at every radius and at every moment of the shower, so the
   picture and the hitbox are the same thing again — which is the property this
   attack kept failing to have.

   The cost is that you can plant in it and stop thinking. That is fine: it is
   50 degrees, you have to FIND it during the wind-up, and it alternates ends
   of the arena. Finding it is the move; surviving it was never meant to be a
   chase you cannot win anyway at 430px/s. */
/* ══ THE DOOR DOES NOT DRIFT, BECAUSE THE CORNER DOES NOT MOVE ═════════════
   A sweeping door and a corner that is "always safe" are the same dial pulled
   in opposite directions: any drift at all walks the wedge off the corner it is
   supposed to be guarding. So the door is pinned.

   The WHEEL still spins — it always did, at AOE_RING_SPIN, and it has been
   decoupled from the door since the two stopped being the same object. What
   moves is the storm going out; what stays is the one triangle. */
var DOOR_SWEEP = 0;
var AOE_RING_SPIN = 2.10;          /* rad/s, the WHEEL - nothing to do with the door */
var AOE_DRAG  = 1.16;              /* see the note on per-spark drag */
/* ══════════ THE DOOR IS A CORNER, AND IT ALTERNATES ═══════════════════════
   It used to aim into the left half, which is where the player already stands,
   so the answer to the attack was "stay roughly where you are". Now it opens on
   one of HIS corners and alternates strictly between them:

       AOE 1   bottom-right      AOE 3   bottom-right
       AOE 2   top-right         AOE 4   top-right      ...

   You cross the arena to reach it, which is the point — the shower sweeps out
   everything else, and the only thing left standing is a small triangle in a
   corner you have to commit to during the wind-up.

   COMPUTED FROM WHERE HE ACTUALLY IS, not stored as a constant. He does not
   stand in the same place on every screen and he drifts while he charges, so a
   fixed bearing would slide off the corner on a different aspect ratio. This
   re-aims at the corner every frame, which is what makes "always safe" true
   rather than nearly true. */
/* ══════════ THE SAFE WEDGE OPENS INTO THE ROOM, NOT INTO A CORNER ═════════
   I aimed this at the screen corner beyond him and that was wrong. The wedge
   in the drawing has its point near HIM and opens LEFT across the room — a long
   triangle you stand inside, bounded on the right by the line you are not
   allowed to cross. Aiming it at the corner put the safe space BEHIND him,
   which is both the wrong shape and somewhere you should never be standing.

   0 = the lower wedge, opening down-left.  1 = the upper, opening up-left.
   They alternate, and he crosses to whichever side is open. */
function doorCornerAngle(which){
  /* AIMED AT A PLACE IN THE ROOM, NOT AT A FIXED BEARING. A fixed angle only
     works while he stands still. He crosses to the top for the upper wedge, and
     up-left FROM the top is off the top of the screen — measured, the safe
     point landed at y = -126 on a 720-tall arena, i.e. the safe space did not
     exist. Aiming at a point instead means the wedge always opens INTO the
     room whatever height he is at, and the triangle is closed off by the top
     or bottom edge exactly as it is in the drawing. */
  /* AIMED SHORT, NOT AT THE BACK WALL. Aiming at 0.28 of the width sent the
     wedge clean across the room to the far edge, so the back corner sat inside
     it and standing there was the whole answer. Aiming at 0.45 points it at the
     middle of the far side instead: the triangle is closed off by the top or
     bottom edge well before it reaches the corner, which is what makes it a
     triangle you have to be IN rather than a corridor you retreat down. */
  /* ════════════════════ PUSHED OUT TO THE EDGE OF WHERE YOU ARE ALLOWED TO BE ════════════════════
     0.45 of the width put the wedge's usable ground straight over the tile arc,
     which sits between 0.31 and 0.39 - so the safe spot was wherever you already
     were and the shower cost nothing. Aiming at 0.57 steepens it: the corridor
     runs up the side of the room near the play wall at 0.66, hard against the
     top or bottom edge, which is as far from the tiles as the arena goes.

     0.03 rather than 0.06 for the same reason - it pins the wedge to the very
     edge of the floor instead of leaving a lane of safe ground outside it. */
  /* ════════════════════ IN THE FINALE IT AIMS WHERE THE WALL IS PUSHING YOU ════════════════════
     Measured with him on the finale post: the wall's only safe ground is the
     player's corner at (26, 694), and the shower's wedge sat on the floor at
     x 488-840, y 224-712 - the opposite corner, 35 degrees off the wedge centre
     against a half-width of 16. Two safe places, mutually exclusive, and the
     player is not allowed to be in both. That is not a hard moment, it is an
     unwinnable one, and it killed a stationary test player at 25.2s of a 30s
     sequence.

     So for the death sequence the door is aimed at the same corner the wall
     leaves open. The shower stops being a second question - which is the point:
     by then there is only one answer on the board and everything on screen
     should be pointing at it. */
  if (F.fin && !F.fin.dead){
    /* ════════════════════ THE TWO HIDES OF THE FINALE ARE AIMED, IN ORDER ════════════════════
       Screen angles: 0 is right, PI/2 is DOWN, PI is left. The first hide opens
       straight out to his left, which is across the room and nowhere near where
       the sweep ends. The second opens mostly down with a tilt back to the
       left, which lands the player on the approach to the pocket rather than in
       it. Between them they walk you there instead of asking you to guess -
       and the pocket itself is the third and last thing you have to find.

       OFF BY ONE ON PURPOSE: hides is incremented when the move STARTS, which
       is before this is first read, so during the FIRST hide the counter
       already reads 1. Testing < 1 gave the first hide the second angle and
       measured 112 degrees when it should have been 180. */
    return (F.fin.hides|0) <= 1 ? 3.14159 : 1.96;
  }
  var tx = VW()*0.57, ty = which ? VH()*0.03 : VH()*0.97;
  return Math.atan2(ty - W.y, tx - W.x);
}

/* ══════════ THE FLURRY SWEEPS ROUND, IT DOES NOT APPEAR AT ONCE ═══════════
   The shower used to light up every bearing except the door on the same frame,
   so the room was simply full and the safe triangle was a hole in a wall that
   was already there. What it should do is TRAVEL: start at one edge of the
   safe wedge, sweep the whole way round the room, and arrive back at the
   wedge's other edge — so the storm visibly engulfs the arena and the last
   thing it reaches is the wall of the place you are standing.

   ONE FUNCTION DECIDES BOTH what emits and what burns. The sparks are drawn
   inside the swept arc and the damage test asks the same question of the
   player's bearing, so the wall you can see arriving IS the wall that hurts —
   there is no second definition to drift out of step, which is the mistake
   this attack has made in three different ways already.

   It sweeps 2*pi - DOOR_SPAN, which is everything except the safe wedge, so it
   can never run over the triangle no matter how the timing rounds. */
/* IT FINISHES EARLY ON PURPOSE. Damage ticks every AOE_TICK_MS, so if the
   sweep were still travelling when the shower ended, the last stretch of it
   would never be sampled by a tick — and that stretch is the far side of the
   room, which is exactly where the player is. Measured with the sweep running
   to the final frame, 63% of the reachable arena was never hit: not because it
   was safe, but because the wall arrived after the last tick.

   Completing at 70% leaves about two full ticks with the whole 310 degrees
   burning, so everything outside the wedge is paid for. */
var AOE_SWEEP_DONE = 0.70;
/* ══ THE RING THE NOVA LEAVES BEHIND — see "the wall you come back through" ══
   84 was sized for the wedge AOE, where he stands past the play wall and half
   the bearings had no arena in them to put a bullet in. The nova fires from the
   middle of the room, so nothing is discarded and 84 became 84: a ring with
   21px between bullets, which is not a wall to dodge through, it is a wall.
   26 is the same ring with room in it. */
/* ════════════════════ THE CREEP GOT 80% WORSE WITHOUT ANYONE TOUCHING IT ════════════════════
   These were set against a 1000ms charge. The charge went to 1800 so the player
   would have time to reach a corner - and the orb count is a RATE, so it went up
   by the same 80% as a side effect nobody asked for. Measured before: 27 arrive
   per nova and 32 are on the floor at the peak, and because they run at 78px/s
   they are all still there for the walk back.

   One per arrival instead of two, at 210ms instead of 150, which lands at about
   fourteen - the density the move had when it was last deliberately tuned. The
   interval is on the panel. */
var NOVA_CREEP_EVERY = 210;   /* ms between arrivals during the cast */
var NOVA_CREEP_N     = 1;     /* how many arrive each time */
var NOVA_CREEP_SPEED = 78;    /* px/s inward - slow enough to still be there after */
function aoeSweptSpan(M){
  if (!M || M.phase === "tell") return 0;
  return Math.min(1, (M.t/AOE_FIRE)/AOE_SWEEP_DONE) * (6.28318 - DOOR_SPAN);
}
function aoeSweepStart(M){
  var s = ((M.dir||-1) < 0) ? -1 : 1;
  return M.doorAng + s*(DOOR_SPAN/2);      /* the safe wedge's near edge */
}
function aoeCovered(a){
  var M = F.move;
  if (!M || M.id!=="aoe" || M.doorAng===undefined) return false;
  var s = ((M.dir||-1) < 0) ? -1 : 1;
  var rel = ((a - aoeSweepStart(M)) * s) % 6.28318;
  if (rel < 0) rel += 6.28318;
  return rel < aoeSweptSpan(M);
}
/* the direction alternates on a fixed list, like everything else here */
var DOOR_DIR = [-1, 1, -1, 1, 1, -1];
var doorIx = 0;

/* radians, screen space. PI is straight LEFT — which is the only direction that
   matters now, because he stands on the right wall and the player cannot cross
   to his side. A gap opening to the right would be a safe sector in a place the
   player is not allowed to stand, i.e. no gap at all. These all point into your
   half, fanned above and below the horizontal. */
var GAP_ANGLE = [3.14, 2.45, 3.85, 2.85, 3.45, 2.25, 4.05, 2.65];
var gapIx = 0;
var galIx = 0;
var boltWalk = 0;
var spiralA = 0;
/* ══════════ THEY CAME OUT IN STRAIGHT LINES, AND HERE IS WHY ═══════════════
   Four arms 1.5708 apart, stepping 0.33 a tick. 1.5708/0.33 = 4.76, which is
   near enough to 5 that every fifth shot landed on very nearly the bearing an
   arm had five ticks earlier — 34px further out, because that is how far a
   bullet travels in 5 ticks. Repeat that and you are not drawing a spiral, you
   are drawing a RADIAL CHAIN of bullets 34px apart. Measured: nearest-neighbour
   52% radial, 48% tangential, i.e. no circular structure at all.

   Near-resonance between the arm spacing and the step is the whole bug, and it
   is invisible in the source — both numbers look arbitrary and fine.

   SO THE WAVE IS THE WHOLE CIRCLE NOW. Every tick emits a complete ring, which
   cannot form a radial chain because there is no preferred bearing left to
   chain along. The ring then rotates between waves by a GOLDEN FRACTION of its
   own gap, which is the one step size that never comes back into phase with
   anything — no resonance is possible rather than merely unlikely.

   CONCENTRIC RINGS WERE THE WRONG SHAPE. I read "radiating circularly" as
   expanding circles; the reference is a PINWHEEL — thick arms that curl round
   as they go out. Rings are the opposite structure, so they were measurably
   circular and still not the picture.

   ARMS WERE ALWAYS THE RIGHT IDEA. What was broken was the pitch. The arm is
   the chain of shots one emitter left behind it, and its members sit
   v*dt apart radially and r*w*dt apart along the arc. At w = 6.0 rad/s that
   arc step was 82px at r=250 while the resonant chain was 34px — so the arm
   was the SPARSER of the two structures and the eye ignored it.

   Slow the emitter and the arm tightens without a single extra bullet:

     w = 2.10 rad/s   ->  arc step 29px at r=250, resonant chain 95px away
     (was              ->  arc step 82px,        resonant chain 34px away)

   The arm now wins by better than three to one at every radius, which is the
   whole fix. It also wraps 1.2 turns between him and the far corner, which is
   what makes it curl rather than point.

   AND IT IS DETUNED ON PURPOSE. Resonance is what drew the straight lines, so
   the step is a golden fraction off a whole number of ticks per arm spacing
   (13.618, not 13 or 14) — the arms can never come back into phase and re-form
   a radial chain at any radius.

   Rate unchanged again: 4 arms every 55ms is 72.7/s, exactly what it always
   was, so the density and the difficulty are untouched. */
var ARM_K = 4, ARM_RATIO = 13.618;
var ARM_STEP = (6.28318/ARM_K)/ARM_RATIO;      /* 0.1153 rad per tick */
function patSpiral(){
  for (var k=0;k<ARM_K;k++){
    bullet(spiralA + k*(6.28318/ARM_K), TUNE.spiral, 7, "86,198,255");
  }
  spiralA += ARM_STEP;
}

/* WHAT IS FIRING RIGHT NOW, AND HOW OFTEN. Every entry is [pattern, interval,
   phase it unlocks at] — one table rather than four timers scattered through
   the step, so the escalation can be read at a glance and tuned in one place. */
/* THE COUNTER-ARM. One spiral is a shape you can walk beside; two turning
   opposite ways close the gaps behind each other, which is the point at which
   standing anywhere stops working and the fight becomes about where you will be
   in a second rather than where you are. Last thing he unlocks. */
var ringIx = 0;
var counterA = 0;
/* three arms turning the other way, same cure. Its old step was 0.27 against a
   2.0944 arm spacing — 7.76, near 8, the same near-resonance one notch worse.
   Detuned to 21.618 ticks per arm and slowed to 1.56 rad/s, which wraps a full
   turn across the arena against the wave's 1.2 in the opposite direction, so
   the two sets of arms cross rather than nest. 3 every 62ms = 48.4/s, as it
   always was. */
var CARM_K = 3, CARM_RATIO = 21.618;
var CARM_STEP = (6.28318/CARM_K)/CARM_RATIO;   /* 0.0969 rad per tick */
function patCounter(){
  for (var k=0;k<CARM_K;k++)
    bullet(counterA + k*(6.28318/CARM_K), TUNE.counter, 7, "240,182,74");
  counterA -= CARM_STEP;
}
/* ══════════════════ THE FIGHT HAD NO FAST THINGS IN IT ═════════════════════
   Every pattern was between 105 and 155 px/s — deliberately, because slow and
   dense is what makes a bullet hell readable. But an arena where EVERYTHING
   drifts has no punctuation: you settle into one pace, and nothing ever forces
   a reaction rather than a plan.

   THAT ARGUMENT LOST, AND THE WHOLE FAST BAND IS GONE WITH IT. See below. */
/* ════════════════════ THE SNIPE IS GONE TOO ════════════════════
   A single 496px/s aimed round, fired ONLY while you were standing on a tile,
   at 900ms intervals whose clock ran only while you stood there. Every part of
   that was deliberate: it was the tax on charging, it billed lingering rather
   than arriving, and it went quiet during breaks when there was nothing to
   charge.

   The reasoning was that standing on a tile should cost something. The problem
   is what it costs. Charging is not a thing you choose to do for value - it is
   the only way to hurt him at all, it takes thirteen and a half seconds, and
   partial progress is reset by leaving. So a round aimed at where you are
   standing does not create a decision; the tile is not optional and neither is
   staying on it. It reads as being shot at for playing the objective.

   With this and the volley out, the fast aimed band is empty and the fight is
   entirely the drift band - arms, ring, fan, spiral - plus the aimed stream at
   300. That is a real loss of punctuation and it is worth knowing rather than
   discovering: nothing in the fight now demands a flinch. If it needs one back,
   it should be a pattern aimed at the ROOM rather than at the player, so it
   presses someone standing on a tile without singling them out for it. */
/* ════════════════════ THE VOLLEY IS GONE ════════════════════
   Three rounds at 660, 620 and 580 fired down ONE line at where you are
   standing. The design note said "the first one moves you and the next two
   punish moving carelessly", and that reasoning holds for a player who is free
   to move. It does not describe this fight.

   It was already barred from breaks. What is left is the main phase - which is
   the phase whose entire job is getting you to stand on a tile for thirteen and
   a half seconds and hold still. Being aimed at where you are standing is not a
   fair trade when standing there is the objective, and three rounds down that
   bearing is not a flinch test, it is a bill. The snipe was removed straight
   after this and for the same reason - see its note above.

   Removed rather than slowed. A slower volley is the same shape - a line you
   have to leave the tile to dodge - and the fight already has plenty that
   presses without taking the objective away from you. */

/* CONSIDERABLY MORE OF EVERYTHING. These intervals were set when the player was
   firing back and standing still to do it; with the pads doing the damage the
   player is MOBILE for almost the whole fight, and a screen tuned for someone
   parked on a tile is close to empty for someone crossing it.

   Roughly doubled across the board, the fan widened from five to seven, the
   spiral doubled to four arms, and every one of them still tightens further per
   tile you have taken on top of this.

   THE `from:` COLUMN SURVIVED THE PHASE REWRITE, and deleting it was a
   regression. It reads against esc()+1 now rather than the broken-segment
   count, but the numbers in it are the ORIGINAL ones and they still mean the
   same thing, because the two counts line up: the fight opens one segment
   down from the intro ram, so old phase 1 IS esc 0.

     esc 0  (main phase 1)   aimed, fan, ring
     esc 1  (break 1 on)     + spiral
     esc 4  (break 4 only)   + the counter-arm

   Dropping it made the OPENING four times busier - the spiral alone is 4
   bullets every 55ms, about 73 a second against the 26 the other three manage
   together - and the main phase was supposed to be untouched. */
var PATTERNS = [
  /* `evK` names a TUNE key that overrides `every`, so an interval can be
     dragged on the panel like a speed. Only the aimed round has one so far. */
  { fn:patAimed,   every: 230, from:1, evK:"aimEvery" },
  { fn:patFan,     every: 800, from:1 },
  { fn:patRing,    every:1900, from:1 },
  { fn:patSpiral,  every:  55, from:2 },
  { fn:patCounter, every:  62, from:3 }
];
/* SIZED FROM THE TABLE, not written out. Two hand-kept literals of seven zeros
   indexed this by pattern, so removing a pattern left a stale slot - and the
   next one added would have read an index that was never reset. */
var patAt = PATTERNS.map(function(){ return 0; });

/* ══════════ NEVER TWO FULL-SCREEN THREATS AT ONCE ═══════════════════════════
   This is the rule the fight was breaking, and it is why it played as
   impossible rather than as hard. The hailstorm covers everything but one
   sector; the nova covers everything but the corners. Running the bullet
   patterns THROUGH either of them means the one safe place is also full of
   bullets — there is no answer, and no amount of skill invents one.

   So during a big move the patterns stand down: nothing at all while it is
   firing, and only the single aimed shot while it winds up, so the arena is
   not completely silent. Every bullet hell does this — the screen-filling
   attack IS the attack, and it gets the screen to itself. */
function bigMoveActive(){
  if (!F.move) return 0;
  if (F.move.id!=="aoe" && F.move.id!=="nova" && F.move.id!=="runes") return 0;
  /* ════════════════════ A BREAK DOES NOT STOP FOR HIM ════════════════════
     This is where the "random sections of completely free space" came from.
     Every big move silenced the patterns - everything during its FIRE, all but
     the aimed round during its wind-up - and in breaks 3 and 4 he is winding up
     or firing for most of the phase. So the bullet hell kept switching itself
     off, the board drained, and what was left was a wide empty room with one
     attack in it.

     In a MAIN phase that silence is right: the big move is the whole question
     and the patterns would bury the answer. In a BREAK the patterns ARE the
     phase, and the big move is a second thing on top. So the suppression is a
     main-phase rule now. */
  if (F.brk) return 0;
  return F.move.phase==="fire" ? 2 : 1;      /* 2 = silence, 1 = aimed only */
}

function stepPatterns(now){
  /* THE PATTERN CLOCK IS THE MONOTONIC ONE, not F.t, and the two transitions
     that wipe the room need to push it forward. Stashed here because this is
     the only function that is handed it. */
  F.clock = now;
  var big = bigMoveActive();
  if (big === 2) return;
  /* ════════════════════ esc()+1, BECAUSE HE STARTS ONE SEGMENT DOWN ════════════════════
     The `from:` numbers were written against F.broken.length, which is 1 at
     the opening because the intro ram takes the segment facing the board. The
     escalation counts tiles and starts at 0. Adding the one lines the two up
     exactly, so every pattern arrives and tightens on the same schedule it
     always did - the opening is the four it always was, and the spiral comes
     in with the first break. */
  var ph = esc() + 1;
  for (var i=0;i<PATTERNS.length;i++){
    var P2 = PATTERNS[i];
    /* THE COUNTER-ARM IS THE LAST CARD, and it is held by BREAK rather than by
       the ladder - `from:3` would have let it in at the third tile, and it is
       meant for the fourth break only. Checked first so the row's own `from`
       never gets a say. */
    if (P2.fn === patCounter){ if (F.brk !== PAD_FORCE) continue; }
    else if (ph < P2.from) continue;
    if (big === 1 && P2.fn !== patAimed) continue;
    /* THE "SILENT AFTER A BIG MOVE" GUARD IS GONE WITH THE BAND IT GUARDED.
       It existed for the two fast aimed patterns, so that a 496-660px/s round
       could not arrive in the beat after a rune or a shower while the player
       was still recovering. Both are removed; nothing left is fast enough to
       need it, and naming a deleted function here is a ReferenceError that no
       syntax check will catch. */

    /* EVERY PATTERN TIGHTENS AS HE LOSES SEGMENTS, on top of unlocking new
       ones. Without it the last two phases fire at the same rate as the one
       that introduced them and the fight plateaus exactly where it should be
       peaking. */
    /* THE FLOOR STAYS even though the gate above now guarantees ph >= from
       for everything except the counter-arm - which is exactly the exception
       that needs it, since it fires at esc 4 against a `from` of 3. Without
       the clamp a pattern let through ahead of its row would fire SLOWER than
       its table interval rather than not at all, in the one direction that
       looks deliberate. */
    var every = (P2.evK ? TUNE[P2.evK] : P2.every) / Math.max(1, 1 + 0.18*(ph - P2.from));
    if (now - patAt[i] < every) continue;
    patAt[i] = now; P2.fn();
  }
}

function fireShot(){ patAimed(); }
/* Rejection sampling rather than enumerating the kept sectors — once two are
   gone they are not contiguous, and this is the same answer in less code. */
/* THE SHOWER HAS TO REACH THE FAR CORNER, or the attack is not an attack — it
   is a hazard you walk away from, and "stand in the gap" stops being the answer
   because "stand over there" also works.

   THE NUMBERS COME FROM THE ARENA. Under drag d per second a particle covers
   v0 * (1 - d^t) / -ln(d); at d=0.86 and t=2s that is about 1.7*v0. The far
   corner from his station is ~1300px on a 1280x820 screen, so v0 has to start
   near 800 and the fast ones near 1700. Both are three times what the welding
   spray uses, which is why they need their own call rather than a bigger rate
   on the old one. */
function aoeSparks(dt, rate){
    /* {B} THEY LEAVE THE SHELL {B}
     0.94 is inside the knotwork, so every spark he throws was born under his
     own art and travelled out through his face - which at the nova's 26,000 a
     second reads as him dissolving rather than as him firing. */
  var R=wedgeR(), n=rate*dt;
  var count = Math.floor(n) + (Math.random()<(n%1) ? 1 : 0);
  var M0 = F.move, firing = !!(M0 && M0.id==="aoe" && M0.phase!=="tell" && M0.doorAng!==undefined);
  var sgn = firing ? (((M0.dir||-1)<0)?-1:1) : 1;
  var st0 = firing ? aoeSweepStart(M0) : 0;
  var span0 = firing ? aoeSweptSpan(M0) : 0;
  for (var i=0;i<count;i++){
    var a, tries=0, gl=liveGaps();
    if (firing){
      /* SAMPLED STRAIGHT INTO THE SWEPT ARC. Rejection sampling would throw
         away 35 of every 36 tries in the first tenth of a second, when the arc
         is ten degrees wide — this is exact and costs one multiply. */
      if (span0 <= 0) continue;
      a = st0 + sgn*Math.random()*span0;
    } else {
      do { a=Math.random()*6.28318; tries++; } while (gapIn(a,gl) && tries<12);
      if (gapIn(a,gl)) continue;
    }
    /* A WIDER SPREAD OF SPEEDS, biased slower. Everything leaving at roughly
       the same rate arrives as a moving RING with clear air behind it; the
       attack wants a filled cone, which means some of it still crossing while
       the rest is already at the wall. */
    /* SIZED TO THE ARENA. The far corner of a 1920x950 window is 2142px from
       him; at AOE_DRAG a particle travels very nearly v0*t, so the SLOWEST one
       needs v0*ttl >= 2142. 950px/s over 2.4s is 2280. Nothing dies mid-flight
       any more - they all leave the screen. */
    var out=950+Math.random()*1500, tang=W.spin*R*0.55;   /* W.spin is rad/s now */
    addSpark(W.x+Math.cos(a)*R, W.y+Math.sin(a)*R,
             Math.cos(a)*out-Math.sin(a)*tang, Math.sin(a)*out+Math.cos(a)*tang,
             2.40+Math.random()*1.30, 0.9+Math.random()*0.1, 0.04, AOE_DRAG);
  }
}
/* HE SPINS FASTER THE MORE OF HIM IS MISSING — two gaps are easier to find than
   one, so the safe sector has to stop being a place and become a moving target
   or the fight gets easier exactly as you win it. */
/* THE DOOR CANNOT MOVE FASTER THAN THE PLAYER CAN RUN, and this is the whole
   constraint on the number. The gap's edge travels at omega * r; the player
   travels at 334px/s; they stand somewhere around 300px out. So the ceiling is
   334/300 = 1.1 rad/s, which at sixty frames is 0.018 rad per frame.

   The first pass used 0.024 rising to 0.244 — up to FOURTEEN radians a second,
   4400px/s at that radius. Not hard: impossible. Nobody was ever going to
   follow that, and the measurements showed exactly what you would expect, with
   a "skilled" run dying at twenty-five seconds having never once been in the
   safe sector while it mattered.

   0.006 to 0.020 sweeps roughly 40 to 130 degrees across the 1.1s shower —
   enough that standing still in the door does not work, and little enough that
   following it is a thing a person can actually do. */
/* THE WHEEL'S SPEED IS THE ESCALATION, NOT THE SHIELD. This read
   F.broken.length, which is 1 or 5 and nothing else now - so the shower would
   have jumped from its slowest to its fastest the moment the first tile lit
   and dropped straight back when the shield returned. Same range, walked in
   four steps by the tiles instead. */
function aoeSpin(){ return 0.36 + 0.21*esc(); }   /* rad/s */
/* ══ A BIG MOVE DOES NOT END THE INSTANT IT STOPS FIRING ═══════════════════
   The screen is still full of the shower when the patterns come back, and the
   620-660px/s aimed rounds are the ones that punish a player who is still
   sorting themselves out — they demand a flinch, and there is no room to flinch
   in yet. Everything else resumes immediately; only the fast pair waits. */
var BIG_QUIET = 1000;
/* ════════════════════ THE LATER MAIN PHASES RUSH, THEN BREATHE ════════════════════
   One flat rest gives every main phase the same shape, and by the third one the
   player has it memorised. Phases 3, 5 and 7 open with all three abilities back
   to back - about a second and a half apart, enough to step onto a tile and not
   enough to stay there - and then stop, so the rest of the phase is the charge
   you were promised. After that first cycle the rest goes long.

   Phase 1 is untouched: it is the arena introducing itself, it opens on the
   runes deliberately, and this only applies once you own a tile.

   ════════════════════ THE GAPS WERE WRITTEN FOR A LONGER PHASE THAN THIS ════════════════════
   4000-4400ms of rest between moves, on top of 3.2-4.1s of wind-up and fire, is
   a seven-and-a-half-second cycle. A main phase is the thirteen and a half
   seconds a tile takes, so he was landing ONE ability in it and the player spent
   the rest of the charge watching an empty room - which is the whole of "we
   barely even see his abilities".

   The rest is scaled rather than rewritten, so the relative shape stays: the
   shower still gets the longest breath after it, the runes the shortest. */
function endMove(gap){
  if (F.move && (F.move.id==="aoe"||F.move.id==="nova"||F.move.id==="runes"))
    F.bigEnd = F.t;
  F.move = null;
  F.mvN = (F.mvN|0) + 1;
  var g;
  if (F.brk || !F.won) g = gap*TUNE.moveGap;   /* the breaks, and the opening */
  else if (F.mvN < 3)  g = TUNE.mainRush;      /* first cycle, back to back */
  else                 g = TUNE.mainRest;      /* and then room to stand */
  F.next = F.t + g;
}

/* `F.armed` IS NOW ALWAYS TRUE and this is the one place that says so. Kept
   as a function rather than deleted with its callers, because it is the answer
   to "why can I shoot" and a reader looking for the gate should find it here
   rather than find nothing. */
function armAlways(){ F.armed = true; }

function stepShots(dt){
  var m=pC();
  for (var i=shots.length-1;i>=0;i--){
    var p=shots[i];
    /* THE WEAVE IS RE-INTEGRATED, NOT BAKED IN. Its heading is the aim; what
       oscillates is a lateral velocity perpendicular to that heading, so the
       round keeps its bearing on average and only its PATH is an S. */
    if (p.wv){
      p.wt += dt;
      var lat = Math.sin(p.wt*p.wf + p.wp) * p.wv;
      p.vx = p.bx*p.bs - p.by*lat;
      p.vy = p.by*p.bs + p.bx*lat;
    }
    p.x+=p.vx*dt; p.y+=p.vy*dt; p.rot+=p.rotV*dt;
    /* RETURN, DO NOT CONTINUE. hurtPlayer detonates the clearing blast, and the
       blast splices this very array — from inside its own loop. Carrying on
       with the old index reads past the new end and throws on the next element.
       Returning is also correct rather than merely safe: everything that was
       about to hit has just been deleted, so there is nothing left to step. */
    if (Math.hypot(p.x-m.x,p.y-m.y) < P.r + p.r){
      shots.splice(i,1); hurtPlayer(shotDmg(),"bullets"); return;
    }
    if (p.x<-70||p.x>VW()+70||p.y<-70||p.y>VH()+70) shots.splice(i,1);
  }
}
/* SHAKE AND FLASH. Neither is decoration: they are the only two things on the
   screen that can say "that just happened" without adding another object to an
   arena that already has ten thousand sparks in it. Both decay on their own and
   both are applied to the CANVAS rather than the page.

   (Restored after a bad cut: removing stepBlasts by deleting everything between
   it and fightStep took this with it, because it happened to live in between.
   The symptom was `kick is not defined` on the first hit — a function used in
   six places and defined in none.) */
var SHAKE = 0, FLASH = 0, FLASH_HUE = "255,180,90";
function kick(shake, flash, hue){
  SHAKE = Math.max(SHAKE, shake);
  FLASH = Math.max(FLASH, flash);
  if (hue) FLASH_HUE = hue;
}
function decayFx(dt){
  SHAKE = Math.max(0, SHAKE - dt*3.4);
  FLASH = Math.max(0, FLASH - dt*3.0);
}

function fightStep(dt, now){
  if (!F.on) return;
  if (rewinding){
    /* nothing else runs: no patterns, no moves, no damage. The projectiles
       still step, because they are travelling backwards under their own
       negated velocity and that is the effect. */
    /* REWIND_RATE IS APPLIED ONCE, INSIDE stepRewind. Passing dt*RATE here as
       well squared it — fourteen times fourteen — and five minutes of tape ran
       out in two frames. The bullets get a gentler multiple on purpose: they are
       travelling under their own reversed velocity, and at full rewind speed
       they simply vanish before anyone sees them turn round. */
    stepRewind(dt);
    stepShots(dt * 3.2);
    return;
  }
  tapeRecord(now);
  F.t += dt*1000;
  /* THE PULSE'S HUE SPIKE EASES BACK HERE, not in decayFx. decayFx runs from
     frame(), which keeps running while the arena is frozen for the tuning panel
     - so the colour would have drained out of a paused pulse while everything
     it belongs to stood still. It is part of the simulation, so it decays with
     the simulation. */
  if (pulseHue > 0) pulseHue = Math.max(0, pulseHue - dt*170);
  /* {B} PLANTED, SO HE PULSES INSTEAD {B}
     Up here rather than down with the patrol, because the move branches return
     before they reach it and he would have pulsed once at the top of a break
     and then never again. A ring off his rim every 1.5s while the shield is
     down: the arms are being DRIVEN by something rather than merely happening,
     and it is the beat that replaces the pacing. */
  if (F.brk && !F.over && !rewinding){
    if (!F.pulseAt || F.t > F.pulseAt){
      F.pulseAt = F.t + 1500;
      /* {B} THE PULSE DOES SOMETHING NOW {B}
         It was a ring in a fixed cream that expanded and changed nothing - so
         it read as decoration bolted on where the pacing used to be, which is
         exactly what it was. Two fixes.

         IT IS HIS COLOUR. The ring takes WALK_COL through the phase palette, so
         it is amber when he is amber and violet when he is violet, and it is
         visibly the same event as everything else he does.

         AND IT SHOVES. Every round inside its radius has its speed scaled,
         hardest right at his rim and falling off to nothing at the edge - so
         the arms VISIBLY surge outward on the beat instead of drifting past it.
         Scaled rather than redirected, because the spirals are already
         travelling radially outward and turning them would break the shape the
         whole pattern is built on. The weaving aimed round carries its base
         speed separately, so that is scaled too or it snaps back next frame. */
      var pr = walkerR()*2.7, kicked = 0;
      for (var pb=0; pb<shots.length; pb++){
        var sh2 = shots[pb], pdx = sh2.x-W.x, pdy = sh2.y-W.y;
        var pd2 = Math.hypot(pdx, pdy);
        if (pd2 < pr && pd2 > 1){
          var bst = 1 + 0.60*(1 - pd2/pr);
          sh2.vx *= bst; sh2.vy *= bst;
          if (sh2.bs) sh2.bs *= bst;
          kicked++;
        }
      }
      F.lastKick = kicked;   /* readable from a test - see the pulse note */
      shocks.push({ x:W.x, y:W.y, r:pr, t:0, ms:950,
                    hue:hx(WALK_COL), hue2:hx("255,120,60") });
      kick(0.30, 0.18, hx("255,170,70"));
    }
  }
  if (F.iframe>0) F.iframe -= dt*1000;
  armAlways(); stepPads(dt); dmgNumStep(dt); lootStep(dt); finStep(dt); statsTime(dt);
  if (F.over) return;

  /* BREAK 1 HAS NO BIG MOVES AT ALL, so there is nothing to schedule and the
     timer must not fall through into a move with a null id - every branch
     downstream switches on that id and not one of them has a default. */
  /* ════════════════════ THE FINALE KEEPS ITS OWN TIMETABLE ════════════════════
     Break 4's set list is ["runes","aoe"] on a rolling gap, which put the first
     hide at PULSE_GRACE and then let a RUNES cast sit between the two - so the
     second hide arrived whenever the filler happened to finish, by which point
     the sweep had eaten the ground the wedge was pointing at. That is what made
     the last pocket unreachable: not the aiming, the timing.

     So the last phase runs to a script. Two hides, at fixed seconds into it,
     and nothing else - no filler to push them late and nothing else competing
     with a line that already kills on contact. F.next is pushed forward until
     the next hide is due, so endMove's rolling gap cannot pull one early
     either.

     NOTE THE TWO CLOCKS. F.t is MILLISECONDS and F.fin.t is SECONDS, which is
     why the conversion is explicit here rather than implied. */
  if (F.fin && !F.fin.dead && !F.move){
    var fh = F.fin.hides|0;
    if (fh >= 2) F.next = F.t + 1e9;              /* the hides are spent */
    else {
      /* SET, NOT MAXED. Taking the later of the two let PULSE_GRACE's 1.6s
         hold the first hide back to 2.2s when the script asks for 0.8 - the
         schedule has to be able to pull a hide EARLIER than the break's own
         opening gap, not only push it later. Overdue clamps to now. */
      var dueMs = (FIN_HIDE_AT[fh] - F.fin.t) * 1000;
      F.next = F.t + Math.max(0, dueMs);
    }
  }
  if (!F.move && F.t >= F.next && moveSet().length){
    F.move = { id:pickMove(), t:0, phase:"tell" };
    /* and in the finale every scheduled move IS a hide */
    if (F.fin && !F.fin.dead) F.move.id = "aoe";
    /* the wind-up cue goes here, once, where the move is BORN - in the tell
       branch it would retrigger every frame for 1.8 to 2.6 seconds */
    /* THE COPY, taken before a single spark exists — see gapIn().

       AND ONLY ONE DOOR, however much of him is missing. Every broken sector was
       a safe sector, so by the late fight the ring had four gaps pointing in four
       directions — most of them behind him, off the edge of the screen, where no
       player could ever stand. On screen that read as safe zones scattered
       nowhere near the arena, which is exactly the complaint. One door, aimed
       into your half, is the attack; the escalation comes from the ring turning
       faster, not from handing out more exits. */
    /* AN EMPTY GAP LIST IS AN UNAVOIDABLE ATTACK, and `[]` is truthy, so it
       sailed through liveGaps() as "no safe sector anywhere" rather than being
       caught. If he somehow has no broken segments when an AOE comes up, the
       move takes the sector facing the player rather than none at all. */
    F.move.gaps = F.broken.length ? [F.broken[0]]
                                  : [segmentAt(Math.atan2(pC().y-W.y, pC().x-W.x))];
    F.move.spin = aoeSpin();

    /* ════ THE DOOR IS AIMED NOW, NOT WHEN THE SHOWER STARTS ═══════════════
       It used to be aimed at the tell -> fire transition, which meant that for
       the ENTIRE 2.6s wind-up the wedge on screen pointed wherever the ring
       happened to have stopped last time — often out to his right, past the
       wall, somewhere the player is not allowed to go — and then snapped to the
       real door at the instant the sparks arrived.

       So the telegraph was showing the wrong answer for the whole time it was
       useful, and the right one only once it was too late to walk there. That
       is the "long period where it is impossible to avoid" exactly: it was not
       impossible, it was mislabelled. Aiming at the top of the move means the
       wedge, the sparks and the damage all agree from the first frame and the
       player gets the full wind-up to cross the arena. */
    /* WHICH WAY IT WILL TURN, AND THEREFORE WHERE IT ENDS, decided here and
       announced by the wheel for the whole wind-up. */
    if (F.move.id === "aoe" && F.move.gaps.length){
      /* strict alternation, bottom-right then top-right */
      F.move.corner = (doorIx++) % 2;
      /* ════════════════════ THE WEDGE AIMS AT THE SIDE HE IS NOT ON ════════════════════
         The corner alternates every cast. His POSITION only alternates outside
         a break - the station below is gated on !F.brk, because during a break
         he has to hold his post. So in a break the two fall out of step, and
         every other cast aimed the wedge at the edge he was already standing
         against. Measured on a 1280x720 arena, that is the difference between:

             crossed        9.1% of the floor,  270 x 390
             not crossed    3.8% of the floor,  455 x  95   <- a sliver

         95px of headroom for a 52px sprite, pinned to the top or bottom edge.
         That is the "impossible to hide" case, and it was never the span that
         was wrong - it was the wedge being aimed along an edge instead of
         across the room.

         So the side is decided from where he will ACTUALLY be when it fires,
         not from the counter. Outside a break he crosses, so it is the corner
         exactly as before and nothing changes. Inside one he stays put, so it
         is whichever half of the room he is not in.

         DECIDED ONCE, HERE. Reading W.y live every frame would flip the wedge
         through 180 degrees the moment he drifted across the midline. */
      /* FROM THE POST HE IS HELD AT, not from W.y. During a break the station
         is pinned to F.brkPost every frame, so that is where he will be when
         this fires; W.y is only where he happens to have drifted to on the
         frame the move began. Outside a break he crosses to the corner, which
         is known outright. */
      /* which of the finale's two hides this is - see doorCornerAngle */
      if (F.fin && !F.fin.dead) F.fin.hides = (F.fin.hides|0) + 1;
      F.move.side = (function(){
        var sy = F.brk ? ((F.brkPost && F.brkPost.y !== undefined) ? F.brkPost.y : W.y)
                       : VH()*(F.move.corner ? 0.82 : 0.18);
        return (sy < VH()*0.5) ? 0 : 1;
      })();
      F.move.from = doorCornerAngle(F.move.side);
      F.move.dir  = F.move.corner ? 1 : -1;
      /* ════════════════════ THE SECOND HIDE SWEEPS AWAY FROM YOU ════════════════════
         dir < 0 starts the sweep at doorAng - DOOR_SPAN/2, the wedge's
         LOWER-angle edge, and covers decreasing angles from there - which on a
         canvas, where y is down and angle grows clockwise, is counterclockwise
         on screen. For a wedge aimed at 112 degrees it opens at 96, the
         right-hand edge, and travels the long way round so the LEFT edge is the
         last ground it takes.

         The player arrives from the left, off the first hide. Sweeping this way
         leaves their side of the wedge standing longest, which is the extra
         time. The first hide keeps the opposite direction so the two do not
         read as one move repeated. */
      if (F.fin && !F.fin.dead) F.move.dir = ((F.fin.hides|0) >= 2) ? -1 : 1;
      /* HE GOES TO THE OPPOSITE SIDE FROM THE SAFE TRIANGLE, and that is what
         makes the triangle a triangle. Standing on the same side as the safe
         wedge, the wedge left him almost level and ran the full width of the
         room to the back wall — a corridor, with the far corner inside it.
         From the far side it points steeply across, and the top or bottom edge
         of the arena closes it off into a wedge with a base.

         It is still the loudest possible tell, just inverted: he rises, so you
         go low. */
      /* likewise - crossing to the far side is a TELL, and a good one, but it
         is a main-phase tell. The wedge is aimed at a point in the room, so it
         opens into the arena correctly wherever he happens to be standing. */
      if (!F.brk) F.station = { x: VW()*0.76, y: VH()*(F.move.corner ? 0.82 : 0.18) };
    }
  }
  stepPatterns(now);
  /* HE PATROLS THE CEILING. Parked in one spot he is a turret, and the aimed
     patterns stop being aimed at anything interesting — every bullet arrives
     from the same bearing and the correct answer never changes. A new post
     every couple of seconds keeps the angles moving without ever bringing him
     down into the arena. */
  /* {B} HE STOPS PACING ONCE THE SHIELD IS OFF {B}
     The patrol exists so the AIMED patterns keep changing their answer - park
     him and every bullet arrives down the same bearing. That reasoning is a
     main-phase one: during a break he is not the question, the floor is, and a
     boss sliding up and down his wall while four hundred rounds come off him
     reads as fidgeting rather than as menace.

     So he plants. What replaces the movement is a PULSE on a beat - a ring off
     his rim every 1.5s, which says the arms are being driven by something
     rather than merely happening. */
  if (F.brk){
    /* {B} ONE POST FOR THE WHOLE BREAK {B}
       Gating the patrol was not enough: every move ENDS with F.station = null,
       so the next frame took a fresh post off the patrol table and he slid to
       it. That is the up-and-down, arriving by a different route than the one
       that was closed. The post is chosen once when the shield comes off and
       restored every frame until it goes back on. */
    if (!F.brkPost) F.brkPost = topStation();
    F.station = F.brkPost;
  } else if (!F.station || (F.roamAt && F.t > F.roamAt && !F.move)){
    F.station = topStation(); F.roamAt = F.t + 2300;
  }
  if (F.station){
    W.x += (F.station.x-W.x)*Math.min(1,2.4*dt);
    W.y += (F.station.y-W.y)*Math.min(1,2.4*dt);
  }

  if (F.move){
    var M=F.move; M.t += dt*1000;
    if (M.id==="aoe"){
      if (M.phase==="tell"){
        /* a corner, so the rotating gap points somewhere reachable — from the
           middle of the arena the sector sweeps the whole floor */
        if (!F.station) F.station = topStation();
        /* ════ THE DOOR IS HELD ON THE TARGET FOR THE WHOLE WIND-UP ═══════
           Aiming it once at the top of the move was still not enough, because
           the ring KEPT TURNING for the 2.6 seconds afterwards — at up to 0.02
           rad a frame over 156 frames that is half a revolution of drift, so a
           door aimed carefully into the player's half arrived pointing at his
           own side of the wall. Every previous fix aimed it correctly and then
           let it wander off before it mattered.

           So there is no spin at all during the wind-up: the door sits exactly
           where the telegraph says it is, for as long as the telegraph is up.
           The rotation starts when the sparks do, which is also better as a
           mechanic — the wind-up asks you to GET there, and the shower asks you
           to keep up. Two separate problems instead of one blurred one. */
        /* ═══════ THE WIND-UP IS A SPIN-UP, NOT A STOP ═══════════════════════
           I had the wheel FREEZE while he charged, on the theory that a stopped
           wheel is a legible tell. It is legible and it is wrong: this attack is
           a wheel throwing sparks off itself, so the charge is the wheel getting
           up to speed. A boss winding up a spin attack by standing perfectly
           still is the one thing the animation must not do.

           BUT THE DOOR STILL HAS TO LAND WHERE THE TELEGRAPH SAID. Spinning
           through the wind-up and then snapping to the start angle is exactly
           the bug the rune beam had — the telegraph pointing one way and the
           attack arriving another.

           So the rotation is INTEGRATED BACKWARDS. Spin ramps from his resting
           turn to full sweep speed across the wind-up; the remaining rotation
           between now and the moment it fires is known in closed form, so the
           angle is set to "where it must end, minus what is still to come". The
           wheel accelerates for 2.6 seconds and arrives at exactly the right
           angle at exactly the right instant, with nothing snapping. */
        /* A PLAIN SPIN-UP. All the backwards integration and the seam decay
           existed to land the WHEEL on an angle that would put the door where
           the telegraph said. The door is not part of the wheel any more, so
           none of that is needed: he just winds up, and the door is already
           parked where it was promised. */
        var Tw = AOE_WIND/1000, tw = Math.min(Tw, M.t/1000);
        var S0 = IDLE_SPIN;
        W.spin = (M.dir || -1) * (S0 + (AOE_RING_SPIN-S0)*(tw/Tw));
        /* RE-AIMED AT THE CORNER EVERY FRAME. This is the promise the whole
           move is built on, and re-deriving it is what keeps it true while he
           drifts around his station during the charge. */
        M.from = doorCornerAngle(M.side || 0);
        M.doorAng = M.from;
        F.aoeGlow = Math.min(1, M.t/AOE_WIND);
        /* ══ THE WIND-UP THROWS ALMOST NOTHING ═══════════════════════════
           It was emitting up to six thousand a second while the wheel was
           STOPPED, so by the time the spin-up gate got its turn there were
           already three thousand sparks on screen and the ramp was invisible.
           A stopped wheel does not throw sparks. A few embers gathering at the
           rim is the entire wind-up now — the storm belongs to the spin, and
           the spin has not started. */
        aoeSparks(dt, 40 + 120*(M.t/AOE_WIND));
        if (M.t>=AOE_WIND){
          M.phase="fire"; M.t=0; F.aoeTick=0; kick(1.3, 0.75, "255,170,70");
          /* THE DOOR HAS TO OPEN INTO THE ROOM. He fires from the top of the
             arena, so a gap pointing UP is a safe sector the player cannot
             reach — the attack would be unavoidable through no fault of theirs.
             The ring is spun so the first gap faces down into the arena at the
             moment the shower starts; after that it rotates and they have to
             follow it.

             OFF A LIST, NOT A ROLL. Which way the door opens is the single most
             important thing to read in the whole fight, so it is the last thing
             that should be luck — the same AOE opens the same way every run. */
          /* the door is aimed by the wind-up and simply left where it is; the
             shower starts turning from exactly the angle the telegraph showed */
          /* ════ THE DOOR OPENS NEAR YOU, NOT ON YOU ═══════════════════════
             It used to be aimed at a fixed bearing that pointed into your half —
             and since you live in the middle of your half, that put the door on
             top of you every single time. The attack could not touch you: you
             were standing in the safe sector before it started, and the measured
             damage from it was zero.

             AIMED AT A PLACE, NOT AT AN ANGLE — and that is the third attempt,
             because the first two were both unreachable for the same reason in
             different disguises. A fixed bearing put the door on top of you. An
             offset from YOUR bearing walked it off the arena instead: he is
             pinned to the right wall, so plus-97-degrees from 180 is straight
             down out of him, which is on HIS side of the split; plus-54 landed
             at x=861 with your wall at 768; and swinging it the other way ran it
             off the top of the screen whenever he happened to be standing high.

             Angles cannot be checked for reachability without knowing where he
             is standing and where the walls are. POINTS CAN. The door is aimed
             at a spot picked from a fixed list of places inside your half, so it
             is somewhere you can stand BY CONSTRUCTION, at every station he
             takes, on every screen size — and the list is fixed, so the fight
             stays the same every run. */

        }
      } else {
        /* ══ THE WHEEL HAS TO BE AT SPEED BEFORE ANYTHING COMES OUT ═══════
           It went from stopped to a full hailstorm in one frame, which threw
           away the only physical cue the attack had: a wheel throws sparks
           BECAUSE it is spinning, so the spin has to arrive first and the
           sparks have to follow it.

           It winds from a standstill to full sweep speed over SPIN_UP, and the
           emission is gated on that fraction cubed — so at half speed it is a
           tenth of the storm, not half of it. The first quarter-second is
           visibly a wheel starting to turn with a few sparks coming off it, and
           only then does the wall arrive. Everything the wedge used to say, said
           by the machine. */
        /* ══ NO SPIN-UP HERE ANY MORE — THE WIND-UP ALREADY DID IT ═════════
           This gate ramped the wheel from a standstill over 420ms because the
           wind-up left it frozen, and it was the thing that enforced "at full
           speed before any sparks". The wind-up now hands the shower a wheel
           ALREADY at full sweep speed, so re-ramping from zero made him
           accelerate for 2.6s, stall dead at the exact moment he fires, and
           then accelerate again — measured at 0.0306 rad/frame dropping to
           0.0155. Straight to full is the continuous motion, and it is also
           what the rule asked for in the first place.

           The emission keeps a 120ms ramp, which is two frames of fade-in so a
           thousand sparks do not appear between one frame and the next. */
        var up = Math.min(1, M.t / 120);
        W.spin = (M.dir || -1) * AOE_RING_SPIN;           /* the wheel */
        /* the door, drifting off the bearing it was held on — a nudge, not a
           chase. It carries on the way the wheel turns so the two still agree
           about direction even though they no longer agree about speed. */
        M.doorAng = doorCornerAngle(M.side || 0);     /* pinned to the far side */
        F.aoeGlow = 1;
        aoeSparks(dt, 26000 * up);
        /* ITS OWN CLOCK, FOUR TIMES A SECOND, OUTSIDE THE I-FRAME WINDOW. On
           the shared 850ms window the entire shower was worth at most two hits.
           A sustained field should be paid for by the second, not by the event —
           and it deliberately does NOT trigger the clearing blast, or standing
           in the fire would be a way to farm breathing room. */
        /* ═══════ THE DAMAGE IS WHERE THE SPARKS ARE ══════════════════════
           It was purely ANGULAR: outside the door, take a quarter of your
           health, anywhere on the screen. So the far corner burned at the
           instant the shower started — before a single spark had travelled a
           pixel toward it — and the picture and the hitbox were two different
           attacks sharing a name.

           There is a WAVEFRONT now. It leaves his rim when the shower starts and
           travels outward under exactly the drag the particles use, so it sits
           on the leading edge of what is drawn. You are burned if you are
           outside the door AND the front has reached you. Standing at the wall
           is safe until it arrives, and then it is not — which is what the
           screen was saying all along. */
        /* THE FRONT RUNS THE SHOWER'S OWN PHYSICS. It was doing 1350 under FULL
           drag while the particles do 950-2450 under almost none, so it fell
           behind its own picture inside half a second and never caught up -
           which is the hitbox not matching the animation. Same speed, same
           drag, same object. */
        if (M.front === undefined){ M.front = wedgeR(); M.frontV = 1700; }
        M.front += M.frontV*dt;
        M.frontV *= Math.pow(SPARK_DRAG*AOE_DRAG, dt);

        if (up > 0.75){
          F.aoeTick -= dt*1000;
          if (F.aoeTick <= 0){
            F.aoeTick = AOE_TICK_MS;
            var pd2 = pC(), dd2 = Math.hypot(pd2.x-W.x, pd2.y-W.y);
            /* the same aoeCovered() the sparks are drawn from */
            if (aoeCovered(Math.atan2(pd2.y-W.y, pd2.x-W.x)) &&
                dd2 <= M.front && dd2 >= walkerR()*0.5){
              hurtPlayer(aoeDmg(),"aoe",true);
            }
          }
        }
        if (M.t>=AOE_FIRE){ W.spin=0.24; F.aoeGlow=0; F.station=null; endMove(4400); }
      }

    } else if (M.id==="nova"){
      var nc = novaCentre(), sr = novaSafeR();
      if (M.phase==="tell"){
        /* ══════ THEY COME IN FROM THE WALLS WHILE HE CASTS ════════════════
           The nova's answer is distance, so it ends with you parked in a corner
           doing nothing for the length of the charge and then walking back
           through an empty room. Both halves of that were dead time.

           So galaxies gather at the OUTSIDE of the room during the cast and
           edge inward at wherever you are standing. They are aimed at you when
           they spawn and then fly straight, so they are not homing - they are a
           net closing on the place you chose, which means the corner that saves
           you from the blast is also the corner they are all converging on.

           Slow enough to still be in the room afterwards, so the walk back is
           through them. That is what the ring at the end of the blast was for,
           and this does the same job while giving the charge something to do.

           Born just OUTSIDE the boundary, so they arrive from off the arena
           rather than appearing inside it. */
        if (M.creepAt === undefined) M.creepAt = TUNE.novaOrbEvery;
        M.creepAt += dt*1000;
        if (M.creepAt >= TUNE.novaOrbEvery){
          M.creepAt = 0;
          /* ════════════════════ EVERYTHING COMES OFF HIM ════════════════════
             These used to be seeded at the boundary of the room and aimed
             inward, which made them the only thing in the fight that arrived
             from somewhere other than Walker - so they read as spawning out of
             nowhere at the screen edge rather than as something he did.

             He is standing in the middle of the room for this move, so firing
             them off his rim gives the same result the drift was after - the
             floor fills between him and the walls, and the walk back is through
             them - and it does it from the source everything else uses. */
          for (var ci=0; ci<NOVA_CREEP_N; ci++){
            var n0 = shots.length;
            bullet(Math.random()*6.28318, NOVA_CREEP_SPEED, 8, "255,150,240");
            /* {B} BIGGER TO LOOK AT, THE SAME SIZE TO HIT {B}
               These are the slowest thing in the fight and they were the
               hardest to see - a mid magenta at r8 drifting across a starfield,
               with the phase palette pulling it darker every break. `sz` scales
               only the DRAWING (rr = r*1.7*sz); `r` is the hitbox and is
               untouched, so they read at half again the size and are no more
               dangerous than they were. */
            if (shots.length > n0) shots[shots.length-1].sz = 1.55;
          }
        }

        /* HE ARRIVES FIRST, THEN WINDS UP. Travelling and charging at once gives
           the player no clean cue for when the clock actually started. */
        F.station = nc;
        if (Math.hypot(W.x-nc.x, W.y-nc.y) > 40){ M.t = 0; }
        else {
          F.novaHeat = Math.min(1, M.t/NOVA_TELL);
          F.aoeGlow = F.novaHeat;             /* he lights up for this one too */
          /* {B} A FLYWHEEL, NOT A DIMMER {B}
             Both other charges freeze the wheel; this one winds it, so the
             three are told apart by the wheel alone before any of the rest of
             the art has resolved. But it was IDLE + 3.6*heat with heat rising
             LINEARLY - a constant acceleration, which the eye reads as "it is
             going round" rather than as "it is winding up". Nothing about a
             straight line feels like spooling.

             Squared and much higher: barely moving for the first half of the
             charge, then tearing by the end. 1.2 rad/s at rest to 15.2 at the
             top, and because the ramp is quadratic most of that arrives in the
             last third - which is exactly where the player needs to be told
             that the clock is nearly out.

             It feeds the sparks for free: aoeSparks() takes its tangential
             component from W.spin, so they whip round with him into a vortex
             instead of drifting straight out. */
          W.spin = IDLE_SPIN + 14.0*Math.pow(F.novaHeat, 2.2);
          for (var nq=0;nq<3;nq++){
            if (Math.random() < 90*dt*F.novaHeat){
              var na=Math.random()*6.28318, nd=340+Math.random()*520;
              addSpark(nc.x+Math.cos(na)*nd, nc.y+Math.sin(na)*nd,
                       -Math.cos(na)*nd*1.9, -Math.sin(na)*nd*1.9, 0.5, 1, 0.02);
            }
          }
          if (M.t>=NOVA_TELL){
            M.phase="fire"; M.t=0; F.novaHeat=1; F.aoeTick=0;
            kick(1.6, 0.9, "255,190,110"); knock(80,26,0.7,0.36);
            shocks.push({ x:nc.x, y:nc.y, t:0, ms:900, r:sr });
          }
        }
      } else {
        /* it does not decelerate the instant it fires - the wheel carries its
           speed through the blast and only lets go when the move ends */
        W.spin = 11.0;
        /* NO GAP AT ALL. Every other shower he has contains a door; this one
           does not, which is exactly why the answer has to be distance rather
           than angle. */
        var R2=wedgeR(), n2=26000*dt;
        var cnt=Math.floor(n2)+(Math.random()<(n2%1)?1:0);
        for (var i2=0;i2<cnt;i2++){
          var a2=Math.random()*6.28318, out2=950+Math.random()*1500;
          addSpark(W.x+Math.cos(a2)*R2, W.y+Math.sin(a2)*R2,
                   Math.cos(a2)*out2, Math.sin(a2)*out2,
                   2.40+Math.random()*1.30, 0.9+Math.random()*0.1, 0.04, AOE_DRAG);
        }
        /* the nova has the same wavefront, for the same reason — it just also
           has an outer limit, because reaching the rim is the whole dodge */
        if (M.front === undefined){ M.front = wedgeR(); M.frontV = 1700; }
        M.front += M.frontV*dt;
        M.frontV *= Math.pow(SPARK_DRAG*AOE_DRAG, dt);
        F.aoeTick -= dt*1000;
        if (F.aoeTick <= 0){
          F.aoeTick = AOE_TICK_MS;
          var pc2 = pC(), dn = Math.hypot(pc2.x-nc.x, pc2.y-nc.y);
          if (dn < sr && dn <= M.front) hurtPlayer(aoeDmg(),"nova",true);
        }
        if (M.t>=NOVA_FIRE){ W.spin=0.24; F.novaHeat=0; F.aoeGlow=0; F.station=null; endMove(4200); }
      }

    } else if (M.id==="runes"){
      /* FORCED ONCE PER CAST, not `if (!F.station)`. He patrols the ceiling
         between moves and the patrol sets a station, so by the time the beam
         comes up F.station is already non-null and the conditional never fired
         - which is exactly how the beam ended up walking the patrol's table
         instead of its own, and never leaving the lower half. */
      /* {B} HE DOES NOT CROSS THE ROOM FOR THIS DURING A BREAK {B}
         The beam fires along HIS axis at HIS height, so varying where it lands
         means moving him - which is exactly the sliding that looks ridiculous
         with four hundred rounds already coming off him. During a break he
         holds whatever post he took when the shield came off, so the beam is
         at one height for that break and a different one the next time. The
         variety survives; the pacing does not. */
      if (!M.stationSet && !F.brk){ M.stationSet = 1; F.station = runeStation(); }
      if (M.phase==="tell"){
        F.runeHeat = Math.min(1, M.t/RUNE_CHARGE);
        W.spin = 0;                            /* stopped: see "the wheel is the tell" */
        /* ══ HE LEVELS OFF BEFORE HE FIRES, and this was the whole bug ═══════
           The wind-up left W.ang at whatever the last move had abandoned it at,
           and only the FIRE phase set it — so the hairline spent 1.8 seconds
           pointing along a stale angle and the beams then snapped to level the
           instant they appeared. The telegraph was drawing a different line from
           the one that burns, which reads exactly as "the animation is somewhere
           else and then it opens on top of me".

           Levelling during the tell means the hairline IS the beam: the line you
           are shown for 1.8 seconds is the line that fires, and the roll is a
           7-degree wobble about it rather than a surprise. */
        W.ang += (0 - W.ang) * Math.min(1, 6*dt);
        /* sparks spiral INTO the runes while they charge — the only place in
           the fight where particles converge, which is what makes it read as
           gathering rather than as another shower */
        var rp = runePos();
        for (var q=0;q<2;q++){
          if (Math.random() < 26*dt*F.runeHeat){
            var ra=Math.random()*6.28318, rd=90+Math.random()*160;
            addSpark(rp[q].x+Math.cos(ra)*rd, rp[q].y+Math.sin(ra)*rd,
                     -Math.cos(ra)*rd*2.2, -Math.sin(ra)*rd*2.2, 0.42, 1, 0.02);
          }
        }
        if (M.t>=RUNE_CHARGE){
          M.phase="fire"; M.t=0; F.runeHeat=1;
          kick(1.1, 0.6, "255,170,70"); knock(150,40,0.5,0.30);
        }
      } else {
        F.runeHeat = 1;
        /* ════ HE GYRATES WHILE THE BEAMS ARE OUT ════════════════════════════
           A boss that fires two straight lines and then holds perfectly still
           for a second and a half looks switched off — the beams are doing all
           the work and he is a picture behind them. Rolling him means the beams
           roll with him, because the emitters are on his flanks: the line stops
           being a fixed height and becomes a slow scissor, so "which side am I
           on" has to be re-answered as it moves rather than decided once.

           Small and fast. A big swing would turn a readable line into a sweep
           nobody can commit to; +/-9 degrees at 5Hz is unmistakably alive and
           still lets you pick a side and stay there. */
        /* ════ HE ROLLS THIRTY DEGREES EACH WAY AND THE BEAMS GO WITH HIM ══
           The beams leave the two marks on his flanks, so if he rolls, they
           roll — the pair stops being a fixed horizontal line and becomes a
           SCISSOR sweeping sixty degrees. "Which side of the line am I on" has
           to be re-answered continuously instead of decided once, and the
           answer is different at the top of the sweep than the bottom.

           Set rather than accumulated: the roll is an absolute angle about the
           horizontal, so it cannot drift over the beam's lifetime the way an
           incremented one would.

           SMALL. Thirty degrees was far too much — at the length these beams
           run, a thirty degree roll sweeps the far end across most of the arena,
           so the line was not a line you pick a side of, it was a windscreen
           wiper. Seven degrees keeps the sweep at the FAR end meaningful (it is
           still a couple of hundred pixels of travel out where the player is)
           while the beam stays recognisably the same horizontal line it started
           as. One number, and it is this one. */
        W.ang = Math.sin(M.t/230) * RUNE_ROLL;
        W.spin = 0;
        W.scale += ((1.06 + Math.sin(M.t/44)*0.04) - W.scale) * (1-Math.pow(1-0.22, dt*60));
        var rp2 = runePos(), m2 = pC();
        for (var b3=0;b3<2;b3++){
          /* the beam sheds along its length, so the line burns rather than
             sitting there as a drawn rectangle */
          if (Math.random() < 130*dt){
            var bd2 = beamDir(rp2[b3].dir), d2 = Math.random()*VW();
            addSpark(rp2[b3].x + bd2[0]*d2 + (-bd2[1])*(Math.random()-0.5)*RUNE_H,
                     rp2[b3].y + bd2[1]*d2 + ( bd2[0])*(Math.random()-0.5)*RUNE_H,
                     bd2[0]*(200+Math.random()*500) + (-bd2[1])*(Math.random()-0.5)*260,
                     bd2[1]*(200+Math.random()*500) + ( bd2[0])*(Math.random()-0.5)*260,
                     0.3+Math.random()*0.5, 1, 0.25);
          }
          /* THE BEAM IS A RAY OUT OF THE MARK, NOT A HORIZONTAL BAND. Now that
             he rolls, "same y as the rune" is meaningless — the test is the
             perpendicular distance to the ray leaving the mark along his own
             axis, and only forward of it. */
          var bd = beamDir(rp2[b3].dir);
          var rx2 = m2.x - rp2[b3].x, ry2 = m2.y - rp2[b3].y;
          var along = rx2*bd[0] + ry2*bd[1];
          var perp  = Math.abs(rx2*(-bd[1]) + ry2*bd[0]);
          if (along > 0 && perp < RUNE_H + P.r) hurtPlayer(F.hpMmax*SHOT_FRAC, "runes");
        }
        if (M.t>=RUNE_FIRE){ F.runeHeat=0; F.station=null; endMove(4000); }
      }

    }
  }
  /* ═══════════ THE WHEEL IS ALWAYS TURNING, AND THAT IS THE TELL ═══════════
     A boss whose ring only moves during one attack has one animation. A boss
     whose ring ALWAYS moves has a resting state — and the moment it stops, or
     changes speed, something is coming. That is a language the player can read
     without being taught it, and it costs nothing to speak:

       turning steadily, in place   nothing is charging, only the patterns
       WINDING UP, rim lit          the AOE — it fires at the speed it reached
       STOPPED DEAD, marks lit      the runes
       steady turn, BUT HE MOVES    the nova, crossing to the middle
     Measured: 0.0200 resting, 0.0201->0.0322 through the AOE wind-up, 0.0000
     for the runes, and 0.0200 for the nova while he walks 239px off his wall.
     Three tells, three different things to look at, and the only one that needs
     the player to judge a SPEED is the one where being wrong just means dodging
     early.

     Two of those are stops and they are told apart by what lights up, which is
     why the rune charge lights only the two marks and the AOE charge lights the
     whole rim. */
  if (!F.move) W.spin += (IDLE_SPIN - W.spin) * Math.min(1, 2.4*dt);

  /* THE RING TURNS. `W.ang += W.spin` existed in exactly one place — the
     cutscene — so for the entire fight the angle never moved. Everything built
     on top of it silently did nothing: the shield never span, the holes never
     travelled, and gapAt() answered against a ring frozen at whatever angle the
     ram left it. The whole "the safe sector is a moving target" design was
     inert, and the AOE was a static wedge you could walk into once and stand in
     forever. One line, and it was the line the mechanic was made of. */
  W.ang = wrapAng(W.ang + W.spin * dt);

  stepShots(dt); stepShocks(dt);
}

/* ── Mih ───────────────────────────────────────────────────────────────── */
function playerStep(dt){
  if (!P.live) return;
  /* ════════════════════ DEAD IS DEAD - THE SHARD STOPS WHERE IT FELL ════════════════════
     P.live still gates the DRAWING, so he stays on the screen where he died;
     what stops is the input and the integration. Coasting on under his own
     momentum after YOU DIED reads as the game not having noticed. */
  if (F.over){ P.vx = 0; P.vy = 0; return; }
  /* CONTROLS ARE FROZEN WHILE TIME RUNS BACKWARDS. The tape is driving him. */
  if (rewinding) return;
  var ax=0, ay=0;
  if (keys.a) ax-=1; if (keys.d) ax+=1;
  if (keys.w) ay-=1; if (keys.s) ay+=1;
  var L=Math.hypot(ax,ay);           /* normalise, or two keys is 1.41x one */
  if (L>0){ ax=ax/L*P_ACC; ay=ay/L*P_ACC; }
  P.vx+=ax*dt; P.vy+=ay*dt;
  var drag=Math.pow(P_DRAG,dt); P.vx*=drag; P.vy*=drag;
  P.x+=P.vx*dt; P.y+=P.vy*dt;
  /* one expression per axis: two ifs fight when the window is narrower than he
     is, and he ends up outside on the side he was pushed away from */
  /* ══════ YOU CANNOT GET BEHIND HIM ═════════════════════════════════════
     "we shouldn't even be allowed to go behind the boss".

     The barrier that came out was a half-arena divider that fenced off a third
     of the room, and removing it was right. This is a different thing: a line
     just short of where he stands, so the room is almost all yours and the only
     place you cannot reach is the space behind his back.

     It is also what makes the safe wedge a TRIANGLE rather than an endless
     cone — the wedge opens out of him to the left and this clips its right-hand
     end, which is the shape in the drawing. */
  var wall = VW()*PLAY_MAX_X;
  var nx=Math.max(0,Math.min(P.x,Math.max(0,wall-P.w)));
  var ny=Math.max(0,Math.min(P.y,Math.max(0,VH()-P.h)));
  if (nx!==P.x){ P.x=nx; P.vx=0; }
  if (ny!==P.y){ P.y=ny; P.vy=0; }
  /* IT POINTS AT HIM, ALWAYS. Leaning into its own velocity was the obvious
     thing and it said the wrong word: a shard has no front, so the only
     information worth spending its orientation on is WHERE THE ENEMY IS. It
     Eased, so a fast pass around him sweeps rather than snapping. */
  var want = Math.atan2(W.y - (P.y+P.h/2), W.x - (P.x+P.w/2));
  var d = want - P.aim;
  while (d >  Math.PI) d -= 6.28318;
  while (d < -Math.PI) d += 6.28318;
  P.aim += d * Math.min(1, 14*dt);
}

/* A BROKEN TILE, IN THE BOARD'S OWN COLOURS. The crack is drawn from the same
   two angles the dead-tile CSS uses, so a shard on the floor and the shard you
   are steering are recognisably the same object. */
function drawPlayer(c){
  if (!P.live) return;
  var m=pC(), s2=P.w/2;
  var flash = F.iframe>0 && (Math.floor(F.iframe/70)%2);
  c.save();
  /* the apex is drawn at -y, i.e. pointing "up" at angle -PI/2, so the aim has
     to be turned a quarter turn to bring the point onto it */
  c.translate(m.x, m.y); c.rotate(P.aim + Math.PI/2);
  c.globalAlpha = flash ? 0.35 : 1;

  c.beginPath();
  c.moveTo(0,-s2); c.lineTo(s2*0.94, s2*0.80); c.lineTo(-s2*0.94, s2*0.80); c.closePath();
  var g = c.createLinearGradient(0,-s2,0,s2*0.8);
  g.addColorStop(0,"#2a1b45"); g.addColorStop(1,"#14101f");
  c.fillStyle=g; c.fill();
  c.lineWidth=2.4; c.strokeStyle="#c9b0ff"; c.stroke();

  c.save(); c.clip();
  c.strokeStyle="rgba(0,0,0,.75)"; c.lineWidth=1.6;
  c.beginPath(); c.moveTo(-s2*0.7,-s2*0.1); c.lineTo(s2*0.25,s2*0.8); c.stroke();
  c.beginPath(); c.moveTo(s2*0.55,-s2*0.5); c.lineTo(-s2*0.1,s2*0.8); c.stroke();
  c.restore();

  /* the glow says "this one is yours" at a glance, among forty that are not */
  c.strokeStyle="rgba(160,120,255,.30)"; c.lineWidth=6;
  c.beginPath();
  c.moveTo(0,-s2); c.lineTo(s2*0.94, s2*0.80); c.lineTo(-s2*0.94, s2*0.80); c.closePath();
  c.stroke();
  c.restore();

  /* ══════════════ THE HITBOX IS DRAWN, AND THIS IS NOT OPTIONAL ═════════════
     The lethal part of the player is a 9px dot inside a 52px triangle, and up
     to now that dot was INVISIBLE — so every near miss looked like a hit that
     should have landed, and every hit looked like a bullet that was nowhere
     near. The player was being judged on a circle they could not see.

     Every game in this genre draws it. It is not a hint or an assist; it is the
     difference between a game that is hard and a game that is arbitrary, and it
     is the single biggest fairness change available here. Drawn ON TOP of the
     shard, always, at exactly P.r. */
  c.globalAlpha = 1;
  c.fillStyle="rgba(0,0,0,.85)";
  c.beginPath(); c.arc(m.x,m.y,P.r+2.5,0,6.28318); c.fill();
  c.fillStyle= flash ? "rgba(255,120,110,.95)" : "rgba(190,255,215,.95)";
  c.beginPath(); c.arc(m.x,m.y,P.r,0,6.28318); c.fill();
  c.fillStyle="rgba(255,255,255,.95)";
  c.beginPath(); c.arc(m.x,m.y,P.r*0.42,0,6.28318); c.fill();
}

/* HE IS ONE OF THE PIECES. Spawned at the board's centre as the rest of it
   comes apart, which is the whole idea: what is left of the board is what
   fights back. */
/* PUT ON YOUR SIDE IMMEDIATELY. Revealed under the board and then walked to the
   left half would mean the first thing the fight does is take control away; the
   cut from the ram to the fight is the one moment where teleporting reads as
   staging rather than as a bug. */
function playerReveal(){
  /* ════════════════════ DEAD CENTRE OF THE BACK WALL ════════════════════
     It used to be 20% across and 62% down, which is nowhere in particular -
     off-centre, slightly low, and close enough to the tiles that the opening
     read as having already started. The back wall, halfway up, is the one spot
     on the floor that is symmetric about everything: the tile arc opens around
     it, he is straight ahead, and neither the high nor the low safe wedge is
     nearer than the other. */
  P.x = Math.max(0, VW()*0.035);
  P.y = Math.max(0, (VH() - P.h) * 0.5);
  P.vx=P.vy=0; P.aim=0; P.live=true;
}
function playerHide(){ P.live=false; }

/* ════════════════════ HE GETS ANGRIER, AND THE ART SAYS SO ════════════════════
   The hue walk already takes him down the rainbow and the glitch filter bends
   him further out of shape every phase, but both are FILTERS - the same drawing
   pushed through different maths. His actual expression never changes, and the
   thing the player is looking at most is his face.

   So the head swaps for an angrier drawing each time a tile lands. F.won is
   exactly the right counter: it goes up the instant the pulse takes his shield
   off, so he changes at the moment the bullet hell starts, and it never goes
   back down - the anger is cumulative, which is the point.

   LAZY, AND OUTSIDE THE LOAD GATE. loadAssets() blocks the fight until artLeft
   hits zero; putting four maybe-missing files in ART would gate the fight on
   art that may never exist. These load on their own and are simply not used
   until they arrive, so the fight runs today with none of them present, runs
   with two of the four, and lights each one up the moment it is dropped in
   boss/ - no code change, no version bump.

   The file each one has to be: 1024x1024, the SHEEP ONLY, transparent outside
   about 0.75 of the half-width. The knotwork ring is a separate layer that
   rotates underneath, and a rage head with a ring baked into it would draw a
   second, stationary ring on top of the turning one. */
var RAGE_IMG = {};
function rageHead(n){
  if (RAGE_IMG[n] === undefined){
    var im = new Image();
    im.src = "../boss/walker_head_rage" + n + ".png";
    RAGE_IMG[n] = im;
  }
  return RAGE_IMG[n];
}
/* the face he is left with, loaded like the rage heads and falling back to
   them if it is not there yet */
var DEAD_IMG = null;
function deadHead(){
  if (DEAD_IMG === null){
    DEAD_IMG = new Image();
    DEAD_IMG.src = "../boss/walker_head_dead.png";
  }
  return DEAD_IMG;
}
function headImg(){
  if (!W.demon) return IMG.idleHead;
  if (F.fin && F.fin.dead){
    var d = deadHead();
    if (d && d.naturalWidth) return d;     /* not here yet? he keeps his rage */
  }
  var n = Math.max(0, Math.min(PAD_FORCE, F.won|0));
  if (n > 0){
    var im = rageHead(n);
    if (im && im.naturalWidth) return im;   /* not here yet? he keeps this face */
  }
  return IMG.demonHead;
}

/* ── drawing ───────────────────────────────────────────────────────────── */
function paintWalker(){
  var pairs = [[$("wRing"), IMG[W.demon?"demonRing":"idleRing"], W.ang],
               [$("wHead"), headImg(), 0]];
  /* HIS SHIELD DROPS WHEN HE DOES. The ring is a separate canvas that keeps
     turning under him; after the EMP it fades out over about a second so what
     is left on screen is the animal and not the armour. */
  var ringA = (F.fin && F.fin.dead) ? Math.max(0, 1 - F.fin.dt/0.95) : 1;
  for (var i=0;i<2;i++){
    var cv=pairs[i][0]; if (!cv) continue;
    var c=cv.getContext("2d"), img=pairs[i][1];
    c.clearRect(0,0,600,600);
    if (!img || !img.naturalWidth) continue;
    if (i === 0 && ringA < 1){ if (ringA <= 0) continue; c.globalAlpha = ringA; }
    c.save(); c.translate(300,300); c.rotate(pairs[i][2]); c.translate(-300,-300);
    /* ════════════════════ THE ART IS FILTERED, NOT REPAINTED ════════════════════
       hue-rotate moves the colour and leaves every bit of the shading and the
       knotwork where it was; a source-atop tint would flatten him to one wash.
       Saturation and contrast climb with the glitch and brightness falls, so
       the last phase is not just a different red - it is a thing that has gone
       wrong. Set inside the save, so restore() puts it back. */
    var _d = whue(), _g = wglitch();
    if (_d || _g > 0.01){
      c.filter = "hue-rotate(" + _d.toFixed(1) + "deg) saturate(" + (1 + 0.55*_g).toFixed(2) +
                 ") brightness(" + (1 - 0.24*_g).toFixed(2) + ") contrast(" + (1 + 0.5*_g).toFixed(2) + ")";
    }
    c.drawImage(img,0,0,600,600); c.filter = "none"; c.restore();
    /* THE BROKEN SEGMENTS ARE CUT OUT OF THE ART. Erased in ring-local space on
       an already-rotated canvas, so the holes travel with the spin exactly as
       gapAt() assumes — which is the whole reason the ring was split off the
       head in the first place. */
    /* THE GLOW GOES ON FIRST AND THE HOLES ARE CUT AFTERWARDS, and the order is
       the whole bug. The charge glow is a `lighter` fill over the entire disc —
       drawn AFTER the sectors were cut away it painted opaque pixels straight
       back into the holes, so during every AOE (which is exactly when anyone
       looks at him) his ring appeared completely intact no matter how much of
       it had been broken off. Cutting last means the holes win. */
    /* ══════════ THE CHARGE GLOW IS A RIM, NOT A WASH ═════════════════════
       It was a `lighter` radial fill across the whole disc in violet, at up to
       0.95 alpha — which did not light his ring, it REPAINTED HIM. A black-and-
       white sheep came out lilac and a red demonic one came out magenta, and
       the art the whole character is built on stopped being visible at exactly
       the moment the player is looking hardest at him.

       It only ever needed to say "this metal is hot". So it is confined to the
       outer eighth of the ring — where the metal actually is — it is warm white
       rather than violet, and it peaks at a third of the alpha. His colours are
       his; the glow sits on the rim and gets out of the way. */
    if (i===0 && F.aoeGlow > 0.02){
      c.globalCompositeOperation="lighter";
      var ga=c.createRadialGradient(300,300,262,300,300,306);
      ga.addColorStop(0,"rgba("+hx("255,220,170")+",0)");
      ga.addColorStop(0.55,"rgba("+hx("255,232,196")+","+(0.20*F.aoeGlow).toFixed(3)+")");
      ga.addColorStop(1,"rgba(255,246,225,"+(0.34*F.aoeGlow).toFixed(3)+")");
      c.fillStyle=ga;
      c.beginPath(); c.arc(300,300,306,0,6.28318); c.fill();
      c.globalCompositeOperation="source-over";
    }
    if (i===0 && F.broken.length){
      c.globalCompositeOperation="destination-out";
      for (var g=0;g<F.broken.length;g++){
        var a0=F.broken[g]*SEG + W.ang;
        c.beginPath(); c.moveTo(300,300); c.arc(300,300,310,a0,a0+SEG);
        c.closePath(); c.fill();
      }
      c.globalCompositeOperation="source-over";
    }

  }
}
function bar(c,x,y,w,h,frac,fill,back){
  c.fillStyle=back; c.fillRect(x,y,w,h);
  c.fillStyle=fill; c.fillRect(x,y,Math.max(0,w*frac),h);
  c.strokeStyle="rgba(0,0,0,.85)"; c.lineWidth=1; c.strokeRect(x+0.5,y+0.5,w-1,h-1);
}
function fightDraw(c){
  if (!F.on) return;
  var m=pC();
  /* the gap, drawn — a positional mechanic with an invisible boundary is a
     guess, and a guess that costs 15hp reads as unfair rather than as hard */
  /* ══════════ THE SAFE WEDGE IS DRAWN AGAIN ═══════════════════════════════
     I removed this when the green ring and the half-arena divider came out,
     and it was the wrong thing to take with them. Those two were clutter: one
     drew a boundary nobody needed and the other drew a rule that no longer
     existed. This one draws THE ANSWER TO THE ATTACK, and a positional
     mechanic with an invisible boundary is a guess — a guess that costs a
     quarter of your health reads as unfair rather than as hard.

     I argued at the time that the object should say it: the wheel stops, the
     segments light, the hole is visible in his art. That reasoning does not
     survive the attack it describes. Once the shower is up, HE IS BEHIND A
     WALL OF SPARKS — the ring is not readable at all, and the only cue left is
     an absence, which is the hardest thing on a screen to locate quickly.

     It is a much stricter wedge than the one that was removed, because the
     door itself is: 50 degrees against the old 137. So it draws as the narrow
     triangle it now is, it turns with the door, and it is exactly DOOR_SPAN
     wide — the same number the damage test uses, so the triangle IS the
     hitbox rather than an approximation of it. */
  if (F.move && F.move.id==="aoe" && F.move.doorAng !== undefined){
    /* {B} THIS WHOLE BLOCK IS SOURCE-OVER, AND THAT WAS THE BUG {B}
       fightDraw runs under globalCompositeOperation = "lighter" - correct for
       everything it was originally drawing, all of which is light being ADDED
       to a dark room. The floor telegraph is the opposite: it SUBTRACTS, it
       takes ground away.

       Under `lighter` a dark fill is a no-op - you cannot add negative light -
       so the scrub that is supposed to black out the swept floor did nothing at
       all, while the hatch and the wedge fill over it brightened a huge area
       into the haze that reads as a blue cloud. And every colour in here came
       out pale, because additive over a starfield washes toward white: that is
       why the edges never looked like his red no matter what they were set to.

       Switched to source-over for the duration and put back afterwards. */
    c.save();
    c.globalCompositeOperation = "source-over";
    var far=Math.max(VW(),VH())*1.5;
    var a0=F.move.doorAng - DOOR_SPAN/2;
    /* {B} A CUT IN THE FLOOR, NOT A SEARCHLIGHT {B}
       The wedge was a bright cyan cone laid over the arena, and at the width it
       needs to be that is an enormous glowing object sitting on top of the one
       part of the screen you are trying to read. It does not need to glow: the
       swept ground either side of it is now scrubbed dark and hatched, so the
       CONTRAST already says where to stand. What was missing was the cut.

       So the fill drops to a whisper - just enough that the safe ground reads
       as deliberately clean rather than as a gap in the hatching - and the two
       edges get the weight instead. Those are the slice. */
    var lit=(F.move.phase==="tell") ? (0.30+0.42*F.aoeGlow) : 0.30;
    /* {B} NO WASH INSIDE THE WEDGE {B}
       Even at source-over, a tint across a wedge that reaches the far corner is
       an enormous coloured object laid over the floor - and the safe ground does
       not need colouring, it needs to be the part that was LEFT. The scrub
       either side is what says so. This is now barely a breath, just enough that
       the clean ground reads as deliberate rather than as a hole in the hatch. */
    var gr=c.createRadialGradient(W.x,W.y,wedgeR(),W.x,W.y,far);
    /* ════════════════════ THE SAFE GROUND IS DRAWN IN HIS COLOUR ════════════════════
       It was cyan - a colour belonging to nothing else in the fight - which
       made the one marking on the floor look like a UI overlay rather than
       something HE is doing to the room. WALK_COL is his own red run through
       the same phase palette his art and his sparks use, so the wedge is amber
       when he is amber and violet when he is violet, and the floor marking and
       the thing marking it are visibly the same event. */
    gr.addColorStop(0,"rgba("+hx(WALK_COL)+","+(lit*0.05).toFixed(3)+")");
    gr.addColorStop(0.5,"rgba("+hx(WALK_COL)+","+(lit*0.02).toFixed(3)+")");
    gr.addColorStop(1,"rgba("+hx(WALK_COL)+",0)");
    c.fillStyle=gr;
    c.beginPath(); c.moveTo(W.x,W.y);
    c.arc(W.x,W.y,far,a0,a0+DOOR_SPAN); c.closePath(); c.fill();

    /* THE TWO EDGES, AS LINES. The gradient says roughly where; the edges say
       exactly where, which is what you need when it is 50 degrees wide and
       moving. */
    /* THE EDGES CARRY IT NOW - a hard pair of lines with a dark keyline under
       them, which is what makes it read as the ground having been CUT rather
       than as light falling on it. */
    c.strokeStyle="rgba(0,0,0,.75)"; c.lineWidth=5;
    for (var ke=0; ke<2; ke++){
      var kea=a0+ke*DOOR_SPAN;
      c.beginPath();
      c.moveTo(W.x+Math.cos(kea)*wedgeR(), W.y+Math.sin(kea)*wedgeR());
      c.lineTo(W.x+Math.cos(kea)*far, W.y+Math.sin(kea)*far);
      c.stroke();
    }
    /* HIS COLOUR, AND NOW IT ACTUALLY ARRIVES AS HIS COLOUR - source-over, so
       255,96,70 is 255,96,70 rather than whatever additive makes of it. */
    /* {B} AND THE WEDGE IS CLOSED AT THE SHELL {B}
       Its two edges start DOOR_SPAN apart on his rim, which is geometrically
       right and reads as two unrelated lines. An arc along the rim between them
       shuts the near end, so it is one shape leaving his shell rather than a
       pair of strays that happen to point the same way. */
    c.strokeStyle="rgba(0,0,0,.75)"; c.lineWidth=5;
    c.beginPath(); c.arc(W.x, W.y, wedgeR(), a0, a0+DOOR_SPAN); c.stroke();
    c.strokeStyle="rgba("+hx(WALK_COL)+","+Math.min(1,(lit*1.5)).toFixed(3)+")";
    c.lineWidth=3;
    c.beginPath(); c.arc(W.x, W.y, wedgeR(), a0, a0+DOOR_SPAN); c.stroke();
    for (var ee=0; ee<2; ee++){
      var ea=a0+ee*DOOR_SPAN;
      c.beginPath();
      c.moveTo(W.x+Math.cos(ea)*wedgeR(), W.y+Math.sin(ea)*wedgeR());
      c.lineTo(W.x+Math.cos(ea)*far, W.y+Math.sin(ea)*far);
      c.stroke();
    }

    /* ════════════════════ THE SWEEP, ANNOUNCED BEFORE IT STARTS ════════════════════
       The wedge says where to stand. It does not say that the whole room is
       about to be swept, nor which side it arrives from - and the flurry does
       not come from everywhere at once, it leaves one edge of the triangle and
       travels all the way round to the other. That is the single most useful
       thing to know and it was not drawn anywhere.

       So an arc walks the exact path the sparks will take, and completes at the
       instant they leave. It is a countdown that is also a map: how long you
       have, and which way it is coming. The old arrow was removed for pointing
       at a door that does not move - this points along a sweep that does. */
    if (F.move.phase==="tell"){
      var sdir = ((F.move.dir||-1) < 0) ? -1 : 1;
      var s0 = aoeSweepStart(F.move);
      var prog = Math.min(1, F.aoeGlow||0);
      var swept = (6.28318 - DOOR_SPAN) * prog;
      /* ════════════════════ THE FLOOR IS THE TELEGRAPH ════════════════════
         A ring with a dot on it is an instrument, and an instrument is one more
         thing to learn while four hundred rounds are in the air. What the player
         actually needs is not "how far round has it got" but WHERE WILL I BE
         ABLE TO STAND - and that is a place on the floor, so it is drawn on the
         floor.

         The ground the sweep is about to take is scrubbed out: darkened and
         hatched, growing round from the wedge's near edge exactly as the flurry
         will travel. What is left un-hatched IS the safe spot - not a symbol
         for it, the actual ground, in its actual shape, at its actual size. By
         the time the sparks leave, everything except the wedge is crossed out.

         Drawn from HIM because that is where the sweep genuinely pivots; unlike
         the ring, this does not need to be read close to him - it is read at
         the far end, where the player is standing. */
      var lead = c.createRadialGradient(W.x, W.y, walkerR()*0.85, W.x, W.y, far);
      lead.addColorStop(0, "rgba(4,3,8," + (0.30 + 0.44*prog).toFixed(3) + ")");
      lead.addColorStop(1, "rgba(4,3,8," + (0.16 + 0.34*prog).toFixed(3) + ")");
      c.save();
      /* {B} THE SCRUB IS A RING SECTOR, NOT A PIE {B}
         A pie from his centre laid the darkening straight over his art, and a
         56-94% black wash over the boss turns him grey for the whole wind-up -
         he looked switched off. Closing the near end at wedgeR() instead of at
         his centre takes the floor away and leaves HIM alone, which is what it
         was always meant to do. */
      c.beginPath();
      c.arc(W.x, W.y, far, s0, s0 + sdir*swept, sdir < 0);
      c.arc(W.x, W.y, wedgeR(), s0 + sdir*swept, s0, sdir >= 0);
      c.closePath();
      c.clip();
      c.fillStyle = lead;
      c.fillRect(0, 0, VW(), VH());
      /* the hatch, so "crossed out" is unmistakable even where the darkening
         lands on ground that was already black */
      c.strokeStyle = "rgba("+hx("255,150,60")+"," + (0.05 + 0.10*prog).toFixed(3) + ")";
      c.lineWidth = 1;
      c.beginPath();
      var step = 46, span = VW() + VH();
      for (var hxx = -VH(); hxx < span; hxx += step){
        c.moveTo(hxx, 0); c.lineTo(hxx + VH(), VH());
      }
      c.stroke();
      c.restore();
      /* the leading edge of the scrub, which is the only moving part left */
      var ha = s0 + sdir*swept;
      c.strokeStyle = "rgba("+hx("255,196,120")+"," + (0.30 + 0.5*prog).toFixed(3) + ")";
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(W.x + Math.cos(ha)*walkerR()*0.85, W.y + Math.sin(ha)*walkerR()*0.85);
      c.lineTo(W.x + Math.cos(ha)*far, W.y + Math.sin(ha)*far);
      c.stroke();
    }
    c.restore();          /* back to `lighter` for everything after this */
  }

  /* THE NOVA'S REACH, DRAWN BEFORE IT ARRIVES. A blast with no door in it is
     only fair if the player can see exactly how far it goes — so the safe line
     is a hard ring that closes in as he charges, the ground inside it darkens,
     and the corners it will leave standing are marked while there is still time
     to reach one. */
  if (F.move && F.move.id==="nova"){
    var nc2=novaCentre(), sr2=novaSafeR(), h=F.novaHeat||0;
    var live = F.move.phase==="fire";
    var rr2 = live ? sr2 : sr2*(0.25+0.75*h);
    var gg2=c.createRadialGradient(nc2.x,nc2.y,0,nc2.x,nc2.y,rr2);
    gg2.addColorStop(0,"rgba("+hx("255,90,20")+","+(live?0.20:0.05+0.13*h).toFixed(3)+")");
    gg2.addColorStop(1,"rgba("+hx("255,40,0")+",0)");
    c.fillStyle=gg2; c.beginPath(); c.arc(nc2.x,nc2.y,rr2,0,6.28318); c.fill();
    c.strokeStyle = live ? "rgba("+hx("255,235,200")+",.95)"
                         : "rgba("+hx("255,150,60")+","+(0.25+0.6*h).toFixed(3)+")";
    c.lineWidth = live ? 5 : 2+3*h;
    c.setLineDash(live?[]:[14,10]);
    c.beginPath(); c.arc(nc2.x,nc2.y,sr2,0,6.28318); c.stroke();
    c.setLineDash([]);
    if (!live && h>0.2){
      var cor=[[0,0],[VW(),0],[0,VH()],[VW(),VH()]];
      c.strokeStyle="rgba("+hx("120,255,180")+","+(0.18+0.4*h).toFixed(3)+")"; c.lineWidth=3;
      for (var ci=0;ci<4;ci++){
        var cx=cor[ci][0], cy=cor[ci][1], sx=cx?-1:1, sy=cy?-1:1;
        c.beginPath();
        c.moveTo(cx+sx*80, cy); c.lineTo(cx, cy); c.lineTo(cx, cy+sy*80); c.stroke();
      }
    }
  }

  /* the beams, and the hairline that says WHERE well before it says HOW MUCH */
  if (F.move && F.move.id==="runes"){
    var rp3=runePos(), hh = F.move.phase==="fire" ? RUNE_H : 2+3*(F.runeHeat||0);
    var far2 = VW()+VH();
    for (var rb=0;rb<2;rb++){
      var rn=rp3[rb], bd3=beamDir(rn.dir);
      var ex=rn.x+bd3[0]*far2, ey=rn.y+bd3[1]*far2;
      if (F.move.phase==="fire"){
        /* DRAWN ALONG THE ROLL, from the mark itself. It used to be an
           axis-aligned fillRect, which was fine while he was level and became a
           lie the moment he started rolling — the damage swept and the picture
           did not. Rotating into his frame keeps the two the same object. */
        /* ══ THE PICTURE WAS A THIRD THE WIDTH OF THE DAMAGE ═══════════════
           The ray was always right — draw and damage read the same runePos()
           and the same beamDir(), so the LINE never disagreed. The GRADIENT
           did. It ran to fully transparent at +/-RUNE_H and only looked solid
           to about +/-12, while the test burns anything within RUNE_H + P.r =
           35px. So the outer two thirds of the kill band was drawn as nothing,
           and standing in it looked like standing beside the beam.

           The band that burns is now opaque to its exact edge, with a hard
           white line ON that edge. The soft part is drawn UNDERNEATH and much
           dimmer, so it cannot be mistaken for the beam itself.

           With a crisp edge at RUNE_H the rule is exactly true as drawn: your
           hitbox dot is P.r across, so if the DOT touches the band you are hit,
           which is precisely what perp < RUNE_H + P.r tests. Nothing is hidden
           in a falloff any more. */
        c.save();
        c.translate(rn.x, rn.y);
        c.rotate(Math.atan2(bd3[1], bd3[0]));

        /* the haze, well outside the kill band and obviously not the beam */
        var og=c.createLinearGradient(0,-hh*3,0,hh*3);
        og.addColorStop(0,   "rgba("+hx("255,60,0")+",0)");
        og.addColorStop(0.5, "rgba("+hx("255,110,20")+",.22)");
        og.addColorStop(1,   "rgba("+hx("255,60,0")+",0)");
        c.fillStyle=og; c.fillRect(0,-hh*3,far2,hh*6);

        /* the band that burns — solid to the edge, no falloff */
        /* ════════════════════ SCORCH, ALL OF IT OUTSIDE THE BAND ════════════════════
           The band is the best-drawn thing in the fight and does not change.
           What it lacked was any sense of DISCHARGE - a perfect rectangle that
           appears and vanishes. Every mark here lives beyond +/-RUNE_H, where
           nothing is tested, so `perp < RUNE_H + P.r` stays exactly as true. */
        c.save(); c.globalCompositeOperation="lighter";
        for (var sc=0; sc<9; sc++){
          var sct=(sc*0.11+0.05), scy=(sc%2?1:-1)*(hh*1.25+(sc*7)%18);
          var scg=c.createLinearGradient(far2*sct,0,far2*(sct+0.16),0);
          scg.addColorStop(0,"rgba("+hx("255,150,60")+",0)");
          scg.addColorStop(0.5,"rgba("+hx("255,190,110")+",.30)");
          scg.addColorStop(1,"rgba("+hx("255,150,60")+",0)");
          c.fillStyle=scg; c.fillRect(far2*sct, scy-1, far2*0.16, 2);
        }
        c.restore();
        var lg=c.createLinearGradient(0,-hh,0,hh);
        lg.addColorStop(0,   "rgba("+hx("255,140,35")+",.97)");
        lg.addColorStop(0.30,"rgba("+hx("255,214,150")+",1)");
        lg.addColorStop(0.5, "rgba("+hx("255,253,244")+",1)");
        lg.addColorStop(0.70,"rgba("+hx("255,214,150")+",1)");
        lg.addColorStop(1,   "rgba("+hx("255,140,35")+",.97)");
        c.fillStyle=lg; c.fillRect(0,-hh,far2,hh*2);

        /* the edge itself. This is the line the player reads, so it is a line. */
        /* A FRINGE JUST OUTSIDE THE EDGE. One pixel of cold either side is
           what stops the band reading as a painted rectangle, and it sits
           BEYOND the white line, so the burn edge is still where it says. */
        c.strokeStyle="rgba(150,235,255,.55)"; c.lineWidth=1;
        c.beginPath();
        c.moveTo(0,-hh-2.5); c.lineTo(far2,-hh-2.5);
        c.moveTo(0, hh+2.5); c.lineTo(far2, hh+2.5);
        c.stroke();
        c.strokeStyle="rgba(255,255,255,.92)"; c.lineWidth=2;
        c.beginPath();
        c.moveTo(0,-hh); c.lineTo(far2,-hh);
        c.moveTo(0, hh); c.lineTo(far2, hh);
        c.stroke();
        /* NO MOUTH FLARE. It read well in the mockup and badly in the fight,
           because the mockup drew one beam from the edge of a frame and the
           fight draws TWO from marks that sit INSIDE his art - so it came out
           as a pair of lens flares parked on his face. The beam already looks
           emitted; it leaves from a rune that is already lit. */
        c.restore();
      } else if (F.runeHeat>0.15){
        /* {B} A BARE STROKE ON A STARFIELD IS NOT A TELEGRAPH {B}
           One line, no shadow, no structure - so the most important warning in
           the fight read as a rendering artefact among the galaxies. Same
           geometry, four passes: a dark underlay so it separates from the
           stars, a bloom falling off toward the far end, dashes that MARCH
           outward so the line has a direction before anything fires, and
           chevrons confirming it. */
        /* {B} IT STARTS ON THE SHELL, LIKE EVERYTHING ELSE HE DRAWS {B}
           The tell ran from the rune MARK, and runePos() puts those at 0.31 of
           his box - deep inside the knotwork. So the safe wedge left his rim,
           the sparks left his rim, and this one line came out of his chest,
           which is what "lines coming out of Walker from different places"
           is. Walked out along its own bearing to wedgeR() so it leaves the
           same edge as the rest. The FIRING band still starts at the mark,
           because the mark visibly lights and the beam has to come from the
           thing that lit. */
        var hcl=F.runeHeat, ddx=ex-rn.x, ddy=ey-rn.y;
        var dL=Math.hypot(ddx,ddy)||1, dux=ddx/dL, duy=ddy/dL;
        var shellT = (function(){
          var vx=rn.x-W.x, vy=rn.y-W.y;
          var bq = vx*dux + vy*duy;
          var cq = vx*vx + vy*vy - wedgeR()*wedgeR();
          var disc = bq*bq - cq;
          return disc > 0 ? Math.max(0, -bq + Math.sqrt(disc)) : 0;
        })();
        var sx0 = rn.x + dux*shellT, sy0 = rn.y + duy*shellT;
        /* ════════════════════ THE WARNING HAS TO OUTREAD THE ROOM ════════════════════
           This is the only thing on screen that says "the floor along here is
           about to kill you", and it was drawn at 1.6px and 0.35 alpha at the
           START of the charge - which is precisely when it matters, because the
           whole point of a tell is the time it buys you. Against a starfield,
           forty drifting bullets and his own glow, that lost.

           Every layer goes up, and the floor of each one goes up more than its
           ceiling: at hcl=0 the dash was 0.35 alpha and is now 0.62, while at
           full charge it moves 0.90 to 0.99. The line is legible the moment it
           appears rather than only once it is nearly too late. A solid core sits
           under the dashes so it reads as one continuous line at a glance and
           as a moving dashed one when you look at it. */
        c.strokeStyle="rgba(0,0,0,.72)"; c.lineWidth=9+5*hcl;
        c.beginPath(); c.moveTo(sx0,sy0); c.lineTo(ex,ey); c.stroke();
        var bmg=c.createLinearGradient(sx0,sy0,ex,ey);
        bmg.addColorStop(0,"rgba("+hx("255,150,60")+","+(0.20+0.34*hcl).toFixed(3)+")");
        bmg.addColorStop(1,"rgba("+hx("255,90,20")+",0)");
        c.strokeStyle=bmg; c.lineWidth=9+14*hcl;
        c.beginPath(); c.moveTo(sx0,sy0); c.lineTo(ex,ey); c.stroke();
        /* the continuous core, under the dashes */
        c.strokeStyle="rgba("+hx("255,214,150")+","+(0.30+0.34*hcl).toFixed(3)+")";
        c.lineWidth=1.2+1.2*hcl;
        c.beginPath(); c.moveTo(sx0,sy0); c.lineTo(ex,ey); c.stroke();
        c.save();
        c.setLineDash([26,16]); c.lineDashOffset=-(F.t*0.07)%42;
        c.strokeStyle="rgba("+hx("255,222,170")+","+(0.62+0.37*hcl).toFixed(3)+")";
        c.lineWidth=3.0+2.4*hcl; c.lineCap="round";
        c.beginPath(); c.moveTo(sx0,sy0); c.lineTo(ex,ey); c.stroke();
        c.restore();
        c.strokeStyle="rgba("+hx("255,236,190")+","+(0.50+0.42*hcl).toFixed(3)+")";
        c.lineWidth=2.2;
        for (var tk=0.16; tk<0.95; tk+=0.16){
          var tpx=sx0+(ex-sx0)*tk, tpy=sy0+(ey-sy0)*tk, tnx=-duy, tny=dux, tS=7.5;
          c.beginPath();
          c.moveTo(tpx+tnx*tS-dux*5, tpy+tny*tS-duy*5); c.lineTo(tpx,tpy);
          c.lineTo(tpx-tnx*tS-dux*5, tpy-tny*tS-duy*5); c.stroke();
        }
      }
      /* the mark itself, lit from cold to white-hot */
      if (F.runeHeat>0.04){
        var gr2=c.createRadialGradient(rn.x,rn.y,0,rn.x,rn.y,17*(2.4+3.4*F.runeHeat));
        gr2.addColorStop(0,"rgba("+hx("255,220,160")+","+(0.5*F.runeHeat).toFixed(3)+")");
        gr2.addColorStop(1,"rgba("+hx("255,80,0")+",0)");
        c.fillStyle=gr2; c.beginPath();
        c.arc(rn.x,rn.y,17*(2.4+3.4*F.runeHeat),0,6.28318); c.fill();
        /* IT IS WHERE THE BEAM COMES FROM, so it gets a rim and spokes rather
           than only a glow - a glow anywhere else on this screen is a bullet */
        c.strokeStyle="rgba("+hx("255,236,200")+","+(0.5+0.4*F.runeHeat).toFixed(2)+")";
        c.lineWidth=1.4;
        c.beginPath(); c.arc(rn.x,rn.y,10+5*F.runeHeat,0,6.28318); c.stroke();
        for (var sk=0;sk<6;sk++){
          var sa=sk*1.0472 + F.t*0.0006;
          c.beginPath();
          c.moveTo(rn.x+Math.cos(sa)*(13+5*F.runeHeat), rn.y+Math.sin(sa)*(13+5*F.runeHeat));
          c.lineTo(rn.x+Math.cos(sa)*(19+7*F.runeHeat), rn.y+Math.sin(sa)*(19+7*F.runeHeat));
          c.stroke();
        }
      }
    }
  }

}
/* ═══════════════════════════ THE BOSS BAR ══════════════════════════════════
   ONE BAR FOR THE WHOLE FIGHT, and it is the only cinematic thing on screen on
   purpose — the arena already has sparks, a rune beam, a rotating safe sector
   and forty tiles drifting through it, and a second piece of furniture up here
   would be competing with all of that.

   THE BAR IS THE WHOLE POOL, not just the shield. His five ring segments and
   the health underneath them are one continuous quantity, so they are one
   continuous bar: it drains right to left, which means the SHIELD is the right
   sixty-three percent and the exposed HEALTH is the left thirty-seven. The
   notches are the segment boundaries, so you can see the next break coming.

   THE COLOUR SPLIT IS THE TELL. Shielded stretches are a deep, dull red;
   the exposed pool is bright. When the shield finally goes, the bar you are
   still chipping at is a completely different colour to the one you started on
   — which is the moment the fight changes, said without a word.

   THE GHOST IS THE OLDEST TRICK IN THE GENRE AND IT EARNS ITS PLACE. A pale
   band lags behind the real value and catches up over half a second, so a hit
   reads as an amount rather than as a new position. Without it, chip damage
   from a single bolt is invisible and the bar looks stuck. */
var BOSS_NAME = "TheOnlyWalker";   /* becomes TheTimeWalker — see the rewind */
/* THE CLOSEST FACE I COULD MATCH to the reference: very heavy, geometric, flat
   terminals. I could not identify the original from the image — if it has a
   name, say it and this is the one line to change. */
var NAME_FONT = '400 30px "Archivo Black","Arial Black",Impact,sans-serif';
/* ONE POOL, so the bar IS the pool. The shield used to be the right 63% of
   this bar and is a state rather than a quantity now - what tells you whether
   he can be hurt is the colour of the whole thing, not a boundary partway
   along it. */
function poolTotal(){ return F.hpWmax; }
function poolLeft(){ return Math.max(0, F.hpW); }
/* ═════════════════════ BULLETS ARE DRAWN, NOT GLOWED ═══════════════════════
   They were soft radial gradients composited with `lighter`, which is why they
   came out as fuzzy blobs that bled into each other and into the starfield —
   additive blending has no edges by definition, and a bullet hell is ENTIRELY
   edges. You are judging a nine-pixel gap between two things; if you cannot see
   where either of them stops, the game is unreadable no matter how fair it is.

   So they are drawn source-over, in three hard passes: a dark rim that
   separates them from whatever is behind, a saturated body, and a white core
   that gives the eye the exact centre. The rim is the part that does the work —
   it is the only reason two overlapping bullets still read as two. */
function drawBullets(c){
  var i;
  /* ═══════════════════ EVERY BULLET IS A LITTLE GALAXY ══════════════════════
     Third pass, and the reference finally explains what the first two were
     missing. Not detail — SHAPE. An arc of constant radius and constant width
     is a ring. Even a proper spiral, drawn at one thickness, is a scribble.

     What reads as a galaxy at eighteen pixels is three things together:
       ARMS THAT TAPER — thick and bright where they leave the bulge, thin and
         faint at the tip, so the eye follows them outward and finds an end;
       A TILT THAT VARIES PER OBJECT — from nearly edge-on to nearly face-on, so
         a field of them is a scattering of separate things rather than a
         stamped pattern;
       A CORE THAT BLOOMS — white at the centre through the body colour, because
         the brightest part of a galaxy is much brighter than its arms and a
         flat core makes the whole thing look like a decal.

     THE BULGE IS THE HITBOX, same contract as the player's own dot. */
  for (i=0;i<shots.length;i++){
    var p=shots[i], rr=(p.r||9)*1.7*(p.sz||1), hue=p.hue||"150,110,255";
    c.save();
    c.translate(p.x,p.y); c.rotate(p.rot||0);

    var hg=c.createRadialGradient(0,0,rr*0.10,0,0,rr*2.0);
    hg.addColorStop(0,"rgba("+hue+",.50)");
    hg.addColorStop(0.5,"rgba("+hue+",.18)");
    hg.addColorStop(1,"rgba("+hue+",0)");
    c.fillStyle=hg; c.beginPath(); c.arc(0,0,rr*2.0,0,6.28318); c.fill();

    c.save(); c.scale(1, p.sq||0.5);
    c.lineCap="round";
    for (var arm=0; arm<2; arm++){
      var ph=arm*3.14159;
      for (var k=0;k<9;k++){
        var t0=k/9, t1=(k+1)/9;
        var a0=ph+t0*3.0, a1=ph+t1*3.0;
        var r0=rr*0.17*Math.exp(1.62*t0), r1=rr*0.17*Math.exp(1.62*t1);
        c.beginPath();
        c.moveTo(Math.cos(a0)*r0, Math.sin(a0)*r0);
        c.lineTo(Math.cos(a1)*r1, Math.sin(a1)*r1);
        /* the taper: fat at the bulge, a hair at the tip */
        /* THINNER AT THE ROOT TOO. 0.40 of the radius made the base of each
           arm 6.8px wide at a 2.6px radius - wider than the space it had to
           live in, so the inner half of the spiral filled solid and became
           part of the bulge. */
        c.lineWidth = rr*(0.15*Math.pow(1-t0,1.4) + 0.040);
        c.strokeStyle = "rgba("+hue+","+(1.0-0.72*t0).toFixed(2)+")";
        c.stroke();
      }
      var kt=ph+1.15, kr=rr*0.17*Math.exp(1.62*0.42);
      c.fillStyle="rgba(255,253,248,.95)";
      c.beginPath(); c.arc(Math.cos(kt)*kr, Math.sin(kt)*kr, rr*0.12, 0, 6.28318); c.fill();
    }
    c.restore();
    c.lineCap="butt";

    /* ══════ THE CORE WAS EATING THE GALAXY ═══════════════════════════════
       It was an opaque disc of rr*0.62 drawn ON TOP of arms that live between
       rr*0.17 and rr*0.86 - so it covered 72% of the spiral and left a band
       2.4 to 3.7 pixels wide, at every bullet size in the game. That is the
       "fuzzy ball": there was no spiral left to see, only a lit dot with a
       halo, and it was never a per-machine difference.

       A quarter of the radius instead. A galaxy's bulge IS small relative to
       its arms - that was the one part of the reference this had backwards. */
    var cg=c.createRadialGradient(0,0,0,0,0,rr*0.26);
    cg.addColorStop(0,"rgba(255,255,255,1)");
    cg.addColorStop(0.30,"rgba(255,250,238,1)");
    cg.addColorStop(0.62,"rgba("+hue+",.85)");
    cg.addColorStop(1,"rgba("+hue+",0)");
    c.fillStyle=cg; c.beginPath(); c.arc(0,0,rr*0.26,0,6.28318); c.fill();
    c.restore();
  }
}

/* ══════════════════ THE PADS, AND WHAT THEY FIRE ══════════════════════════
   A pad is a keno tile sitting in the arena. Cold it is an outline; charging it
   fills from the bottom like a glass; charged it wears the RAINBOW the max-win
   animation uses, which is the game's own vocabulary for "this tile is worth
   something" and needs no explaining to anyone who has seen one.

   THE BEAMS CONVERGE BEFORE THEY LAND. Each pad throws a thin line to a meeting
   point out in front of him and one thick trunk goes the rest of the way, so
   four lasers read as one weapon getting heavier rather than as four weapons.
   It is the superlinear damage, drawn. */
function padEdge(pd,h,f){
  var t=f*4, side=Math.floor(t), u=t-side;
  if (side===0) return [pd.x-h+PAD_W*u, pd.y-h];
  if (side===1) return [pd.x+h, pd.y-h+PAD_W*u];
  if (side===2) return [pd.x+h-PAD_W*u, pd.y+h];
  return [pd.x-h, pd.y+h-PAD_W*u];
}
/* the label is its own pass because it needs the tile's POSITION without the
   tile's ORIENTATION - see the note at the call site */
/* {B} CORNER TICKS ARE THE CHEAPEST "THIS IS A CARD" {B}
   Four L-shaped registration marks, the way a printed tile is trimmed. It is
   the one detail that stops a stroked rectangle reading as a stroked
   rectangle. */
function padCorners(c, pd, h, col, w){
  c.strokeStyle=col; c.lineWidth=w||2;
  var L=11, o=2.5, i, sg=[[-1,-1],[1,-1],[-1,1],[1,1]];
  for (i=0;i<4;i++){
    var x=pd.x+sg[i][0]*(h-o), y=pd.y+sg[i][1]*(h-o);
    c.beginPath();
    c.moveTo(x-sg[i][0]*L, y); c.lineTo(x,y); c.lineTo(x, y-sg[i][1]*L);
    c.stroke();
  }
}

function padLabel(pd, h){
  /* ════════════════════ LEVEL. IT WAS NEVER GOING TO WORK PARALLEL. ════════════════════
     Three goes at "along the tile's edge" and all three read as wrong on the
     screen: inside the rotation it came out mirrored, flipped-to-readable it
     matched no edge you could see, and nearest-to-level put it across a corner.
     The tiles are rotated by where the gem is, which is an angle chosen for the
     TILES - there is no reason a word has to inherit it.

     So it is horizontal, centred under the tile, every time. It cannot mirror,
     it cannot collide with a corner, and it reads at a glance from anywhere in
     the arena - which is the whole job of a label that appears while you are
     being shot at. */
  var c = FX; if (!c) return;
  c.save();
  c.textAlign = "center"; c.textBaseline = "middle";
  c.font = '700 15px ui-monospace,Consolas,monospace';
  c.lineJoin = "round"; c.miterLimit = 2;
  /* THE TILE'S OWN COLOUR, not a stock green. Each tile keeps a hue for the
     whole fight and its number is already drawn in it - "the green one is the
     awkward one" is a thing you learn without being told - so a label belonging
     to a tile has no business arriving in a colour that belongs to none of
     them. Same hue as its digit, one step brighter so it reads off the floor. */
  c.strokeStyle = "rgba(3,6,10,.92)"; c.lineWidth = 4.5;
  c.strokeText("RESTORING", pd.x, pd.y + h + 17);
  c.fillStyle = "hsla("+pd.hue+",95%,72%,1)";
  c.fillText("RESTORING", pd.x, pd.y + h + 17);
  c.restore();
  c.textBaseline = "alphabetic";
}

function drawPads(c, now){
  FX = c;
  if (!F.on) return;
  /* ════════════════════ THE DARK TILES GO; THE LIT ONES ARE THE CIRCUIT ════════════════════
     An unlit tile during a break is pure clutter: a bordered square sitting in
     the middle of the floor you are reading four hundred rounds across, marking
     a thing you cannot charge until the shield is back. Those are hidden.

     The LIT ones stay, and so do the rays and the gem, because together they
     are the only picture of why the health bar is moving - four tiles feeding a
     stone that fires one line into him. Hiding that during the phase where the
     damage actually happens was hiding the point of the phase. */
  var live=[], m=pC(), i, fp=focusPos();
  for (i=0;i<pads.length;i++){
    var pd=pads[i], h=PAD_W*0.5;
    if (F.brk && !pd.on) continue;      /* see the note at the top */
    var frac=Math.min(1, pd.t/PAD_CHARGE_MS);
    var hot=Math.abs(m.x-pd.x)<h && Math.abs(m.y-pd.y)<h;
    /* THE TILE IS TURNED TO FACE THE FOCUS. It is aiming at the thing it feeds,
       so it looks at it — and a row of them fanned toward one point reads as a
       circuit at a glance, which four axis-aligned squares never did.

       THE NUMBER STAYS UPRIGHT REGARDLESS. The tile turning is scenery; the
       number is information, and rotated information is worse information. The
       text is drawn in its own untransformed pass further down. */
    c.save();
    c.translate(pd.x, pd.y);
    c.rotate(Math.atan2(fp.y-pd.y, fp.x-pd.x));
    c.translate(-pd.x, -pd.y);

    if (pd.on){
      /* LIT: FILLED, and radiating. A rainbow outline said "special"; a rainbow
         FILL says "this one is firing", which is the thing the player needs to
         count at a glance. The gradient runs corner to corner and the whole
         cycle drifts, so a row of lit tiles is a moving spectrum rather than
         eight squares flashing in unison. */
      var ph=(now*0.00016 + i*0.13)%1;
      var lg=c.createLinearGradient(pd.x-h,pd.y-h,pd.x+h,pd.y+h);
      for (var g2=0; g2<=6; g2++){
        lg.addColorStop(g2/6, "hsl("+(((ph+g2/6)%1)*360).toFixed(0)+",100%,58%)");
      }
      /* the radiance, under the tile */
      var rg=c.createRadialGradient(pd.x,pd.y,h*0.5,pd.x,pd.y,h*2.4);
      rg.addColorStop(0,"hsla("+((ph*360)|0)+",100%,62%,.34)");
      rg.addColorStop(1,"hsla("+((ph*360)|0)+",100%,62%,0)");
      c.fillStyle=rg; c.beginPath(); c.arc(pd.x,pd.y,h*2.4,0,6.28318); c.fill();

      /* {B} THE SPECTRUM BELONGS IN THE RIM, NOT THE FACE {B}
         A full-saturation seven-stop rainbow FILL is the loudest object on a
         screen whose whole palette is rust, dried blood and cold starlight -
         and it was painted across the floor you read four hundred rounds over,
         four times. The rim keeps every bit of "this one is firing": it is
         still brighter than anything else down there and it still drifts. The
         face going dark is the floor being handed back. */
      var lf=c.createRadialGradient(pd.x,pd.y,2,pd.x,pd.y,h*1.1);
      lf.addColorStop(0,"hsla("+((ph*360)|0)+",100%,70%,.30)");
      lf.addColorStop(1,"rgba(5,5,10,.92)");
      c.fillStyle=lf; c.fillRect(pd.x-h, pd.y-h, PAD_W, PAD_W);
      c.strokeStyle=lg; c.lineWidth=3.5;
      c.strokeRect(pd.x-h+1.75, pd.y-h+1.75, PAD_W-3.5, PAD_W-3.5);
      c.strokeStyle="rgba(255,255,255,.35)"; c.lineWidth=1;
      c.strokeRect(pd.x-h+4.5, pd.y-h+4.5, PAD_W-9, PAD_W-9);
      padCorners(c, pd, h, "rgba(255,255,255,.9)");
      live.push(pd);
    } else {
      /* {B} A KENO TILE, NOT A STROKED RECT {B}
         Black square, 2px outline, done - legible, and a placeholder. A double
         frame, a diagonal sheen and corner ticks are the vocabulary of a
         physical numbered tile, which is the one thing these actually are. */
      c.fillStyle="rgba(6,6,11,.82)";
      c.fillRect(pd.x-h, pd.y-h, PAD_W, PAD_W);
      var shn=c.createLinearGradient(pd.x-h,pd.y-h,pd.x+h,pd.y+h);
      shn.addColorStop(0,"hsla("+pd.hue+",60%,60%,.10)");
      shn.addColorStop(0.5,"hsla("+pd.hue+",60%,60%,0)");
      c.fillStyle=shn; c.fillRect(pd.x-h, pd.y-h, PAD_W, PAD_W);
      if (frac>0){
        /* {B} THE MENISCUS {B}
           A flat translucent fill creeping up the square cannot be read at a
           glance - 40% and 55% look the same. One bright line at the surface of
           the fill is the most readable progress cue there is, and thirteen and
           a half seconds of standing still under fire has earned one. */
        /* {B} IT FILLS TOWARD HIM, NOT UPWARD {B}
           A bottom-up fill is a battery gauge - it has nothing to do with what
           the tile is for. This whole block is drawn inside the tile's own
           rotation, and that rotation points local +x at the gem the tile
           feeds, which is his side of the room. So the charge starts at the far
           edge and advances toward him, and the bright leading edge travels the
           same direction the ray will. The tile is visibly loading. */
        var edge = pd.x - h + PAD_W*frac;
        var flg=c.createLinearGradient(pd.x-h,0,edge,0);
        flg.addColorStop(0,"hsla("+pd.hue+",92%,55%,.42)");
        flg.addColorStop(1,"hsla("+pd.hue+",92%,66%,.16)");
        c.fillStyle=flg; c.fillRect(pd.x-h, pd.y-h, PAD_W*frac, PAD_W);
        c.fillStyle="hsla("+pd.hue+",100%,80%,.28)"; c.fillRect(edge-7, pd.y-h, 6, PAD_W);
        c.fillStyle="hsla("+pd.hue+",100%,86%,.95)"; c.fillRect(edge-1.25, pd.y-h, 2.5, PAD_W);
      }
      c.strokeStyle="hsla("+pd.hue+",55%,40%,.55)"; c.lineWidth=1;
      c.strokeRect(pd.x-h+0.5, pd.y-h+0.5, PAD_W-1, PAD_W-1);
      c.strokeStyle = hot ? "hsla("+pd.hue+",95%,72%,1)" : "hsla("+pd.hue+",75%,58%,.85)";
      c.lineWidth = hot ? 2.5 : 1.5;
      c.strokeRect(pd.x-h+5.5, pd.y-h+5.5, PAD_W-11, PAD_W-11);
      /* quarters on the frame, so the number is readable without a number */
      /* the quarters turn with the fill - they mark the same axis it travels */
      c.strokeStyle="hsla("+pd.hue+",90%,70%,.45)"; c.lineWidth=1;
      for (var qq=0; qq<3; qq++){
        var qx=pd.x-h+PAD_W*(0.25+0.25*qq);
        c.beginPath(); c.moveTo(qx,pd.y-h); c.lineTo(qx,pd.y-h+7);
        c.moveTo(qx,pd.y+h); c.lineTo(qx,pd.y+h-7); c.stroke();
      }
      padCorners(c, pd, h, "hsla("+pd.hue+",90%,70%,.95)");
      /* ════════════════════ PARALLEL TO THE TILE, BUT NEVER UPSIDE DOWN ════════════════════
         A tile pays a bomb and a quarter of your health and nothing on screen
         said so. This was drawn inside the tile's own rotation, which put it
         along the back edge correctly and MIRRORED it - the tiles at the bottom
         of the arc are turned about -60 degrees, and -60 minus another 90 puts
         the text past vertical and reading right-to-left, which is what the
         screenshot showed.

         So it is positioned from the rotation and then oriented on its own: the
         edge's own bearing, flipped by pi whenever that bearing would land in
         the half of the circle where text reads backwards. Still parallel to
         the square; always readable. */
      if (hot) padLabel(pd, h);
    }

    /* THE NUMBER FACES HIM. A keno tile lying in the arena is a tile that has
       been TURNED to look at the thing it is shooting — so the digits' "up"
       points at Walker, and the row of them fans as he moves along his wall.
       It is also the cheapest possible reminder of which way the fight is. */
    c.restore();   /* end of the tile's own rotation — the number is upright */

    /* ════════════════════ THE NUMBERS WERE BEING DRAWN OFF THE SCREEN ════════════════════
       This was `c.save(); c.translate(pd.x,pd.y); c.restore();` - a save and a
       restore with nothing between them, which is exactly nothing - and then
       fillText at (0,0). So the digit was placed at local origin while the
       TILE'S OWN ROTATION was still on the context, which maps (0,0) to
       c - R*c rather than to the tile. Measured on a 1920x1080 board, the four
       numbers landed at (-413,968), (-180,215), (153,-160) and (458,-521):
       three of them off the canvas entirely and not one of them on its tile.

       The restore has to close the rotation BEFORE the text, not after it. */
    /* UPRIGHT. No rotation at all — not a facing, not a lean. A keno tile is
       read by its number and nothing else, and every degree of rotation costs
       legibility for a piece of information the player already has from the
       geometry: he is on the right, always. */
    /* ════════════════════ THE NUMBER HAS TO SURVIVE WHATEVER IS UNDER IT ════════════════════
       A flat fill was fine on the dark idle tile and unreadable on the lit one,
       which is a moving full-saturation spectrum - dark ink lands on a navy
       facet for a third of the cycle and disappears. An outline fixes it in
       both states at once and costs one extra pass: near-black around the
       digit, then the digit, so it reads on a black tile, on a yellow one, and
       on anything the phase palette turns them into. */
    c.font = "700 " + Math.round(PAD_W*0.40) + "px ui-monospace,Consolas,monospace";
    c.textAlign="center"; c.textBaseline="middle";
    c.lineJoin = "round"; c.miterLimit = 2;
    c.strokeStyle = "rgba(4,3,10,.92)"; c.lineWidth = 5;
    c.strokeText(String(pd.n), pd.x, pd.y);
    c.fillStyle = pd.on ? "#ffffff" : "hsla("+pd.hue+",92%,74%,1)";
    c.fillText(String(pd.n), pd.x, pd.y);
    c.textBaseline="alphabetic";
  }
  /* THE DIAMOND IS ALWAYS THERE, lit or not — a piece of equipment standing in
     the arena rather than something that appears when it is used. Dark and
     inert with nothing feeding it; blazing with four. */
  /* ════════════════════ AND THE DIAMOND STOPS TURNING ════════════════════
     Its angle was read straight off the clock, which does not stop when you do,
     so it kept spinning over the death screen - the last moving thing in a
     stopped arena. Latched instead: the angle only advances while the fight is
     live, and holds wherever it was. */
  if (!F.over) gemSpin = now*0.0011;
  var k=live.length, spin=gemSpin, sz=26+k*4;
  c.save();
  c.translate(fp.x,fp.y); c.rotate(spin);
  if (k){
    var fg=c.createRadialGradient(0,0,0,0,0,sz*3.2);
    fg.addColorStop(0,"rgba(200,170,255,"+(0.30+0.12*k).toFixed(2)+")");
    fg.addColorStop(1,"rgba(160,120,255,0)");
    c.fillStyle=fg; c.beginPath(); c.arc(0,0,sz*3.2,0,6.28318); c.fill();
  }
  if (!k){
    /* {B} A LOOSE GEM ON THE FLOOR IS A PICKUP {B}
       Sitting there dimmed with nothing happening, the most valuable-looking
       object in the product reads as something to go and collect - which is
       exactly the wrong instruction in a room where the floor is the hazard.
       It is not there until a tile feeds it. The first ray is what installs
       it, and after that the brackets below say it is mounted, not dropped. */
    c.restore();
    return;
  }
  if (GEM_IMG && GEM_IMG.naturalWidth){
    /* THE MOUNT. Four brackets around the stone, so even mid-fight it reads as
       apparatus the tiles are wired into rather than treasure. */
    c.strokeStyle="rgba(196,178,240,.85)"; c.lineWidth=2.5;
    var mb=sz*1.34, ml=sz*0.46, mi;
    for (mi=0; mi<4; mi++){
      var mA=mi*1.5708 + 0.7854;
      var mx=Math.cos(mA)*mb, my=Math.sin(mA)*mb;
      c.save(); c.translate(mx,my); c.rotate(mA);
      c.beginPath(); c.moveTo(-ml*0.5,-ml*0.5); c.lineTo(0,0); c.lineTo(-ml*0.5, ml*0.5);
      c.stroke(); c.restore();
    }
    c.drawImage(GEM_IMG, -sz, -sz, sz*2, sz*2);
  } else {
    /* the old rhombus, kept as the fallback for the frames before the data URI
       has decoded - without it the focus vanishes for the first frame or two */
    c.beginPath();
    c.moveTo(0,-sz); c.lineTo(sz*0.72,0); c.lineTo(0,sz); c.lineTo(-sz*0.72,0);
    c.closePath();
    c.fillStyle = k ? "rgba(60,36,110,.92)" : "rgba(18,14,30,.85)";
    c.fill();
    c.lineWidth = 2.5;
    c.strokeStyle = k ? "rgba(235,220,255,.95)" : "rgba(120,100,170,.55)";
    c.stroke();
  }
  c.restore();

  /* THE TILES STOP FIRING WHEN THE FIGHT DOES. hurtWalker already returns on
     F.over so no damage was landing, but the conduit and the ray carried on
     being DRAWN - four tiles beaming into a boss over a death screen. The tiles
     and the focus itself stay; only the firing goes. */
  if (!k || F.over) return;

  /* ════════════════════ THE FEED CARRIES SOMETHING; IT IS NOT A WIRE ════════════════════
     Two straight strokes from live[b].x,live[b].y to the focus - and that is the
     tile's CENTRE, which is where the NUMBER is. So the beam came out of the
     glyph, exactly the way the sparks used to come out of Walker's face instead
     of his shell. Worse, nothing about it moved: four tiles "feeding" a diamond
     looked like four tiles WIRED to a diamond, with no evidence anything was
     being delivered.

     The start point is free. Every tile is already rotated to face the focus,
     so the direction to the focus IS the tile's local +X and its leading edge
     sits exactly PAD_W*0.5 along that line - no trigonometry, no intersection
     test. The conduit leaves the middle of the edge that points at the thing it
     feeds.

     Then charge actually travels it: packets running tile -> diamond, evenly
     spaced in phase and offset per tile so the four conduits never pulse in
     lockstep. Each accelerates as it goes and brightens with it, because being
     pulled in reads as delivery where a constant-speed dot reads as a marquee.
     The focus flares when one lands. */
  c.globalCompositeOperation="lighter";
  var flow = now*0.00058, arrive = 0, PK = 3;
  for (var b=0;b<live.length;b++){
    var pdb = live[b];
    var fdx = fp.x-pdb.x, fdy = fp.y-pdb.y, fdl = Math.hypot(fdx,fdy)||1;
    var fux = fdx/fdl, fuy = fdy/fdl;
    var sx4 = pdb.x + fux*(PAD_W*0.5), sy4 = pdb.y + fuy*(PAD_W*0.5);
    var runL = Math.max(1, fdl - PAD_W*0.5);

    /* the conduit itself, dim at the tile and bright at the diamond - the
       gradient alone says which way it flows even between packets */
    var cg = c.createLinearGradient(sx4,sy4,fp.x,fp.y);
    cg.addColorStop(0,"rgba(150,110,255,.22)");
    cg.addColorStop(1,"rgba(205,170,255,.62)");
    c.strokeStyle = cg; c.lineWidth = 2.6 + k*0.45;
    c.beginPath(); c.moveTo(sx4,sy4); c.lineTo(fp.x,fp.y); c.stroke();
    c.strokeStyle = "rgba(255,255,255,.28)"; c.lineWidth = 1;
    c.beginPath(); c.moveTo(sx4,sy4); c.lineTo(fp.x,fp.y); c.stroke();

    for (var q=0;q<PK;q++){
      var ph = (flow + b*0.37 + q/PK) % 1;
      var tt = Math.pow(ph, 1.45);            /* accelerating into the focus */
      var px4 = sx4 + fux*runL*tt, py4 = sy4 + fuy*runL*tt;
      var pa = 0.30 + 0.70*tt, pr = 2.8 + 3.2*tt;
      var trail = pr*3.4;
      c.strokeStyle = "rgba(235,215,255," + (pa*0.42).toFixed(3) + ")";
      c.lineWidth = pr*0.8;
      c.beginPath();
      c.moveTo(px4 - fux*trail, py4 - fuy*trail); c.lineTo(px4, py4); c.stroke();
      var pgr = c.createRadialGradient(px4,py4,0,px4,py4,pr*2.6);
      pgr.addColorStop(0,"rgba(255,255,255," + (pa*0.95).toFixed(3) + ")");
      pgr.addColorStop(0.42,"rgba(214,180,255," + (pa*0.45).toFixed(3) + ")");
      pgr.addColorStop(1,"rgba(150,110,255,0)");
      c.fillStyle = pgr;
      c.beginPath(); c.arc(px4,py4,pr*2.6,0,6.28318); c.fill();
      if (ph > 0.86) arrive = Math.max(arrive, (ph-0.86)/0.14);
    }
  }
  if (arrive > 0){
    var flr = (13 + k*4) * arrive;
    var fgr = c.createRadialGradient(fp.x,fp.y,0,fp.x,fp.y,flr);
    fgr.addColorStop(0,"rgba(255,255,255," + (0.50*arrive).toFixed(3) + ")");
    fgr.addColorStop(0.45,"rgba(205,170,255," + (0.28*arrive).toFixed(3) + ")");
    fgr.addColorStop(1,"rgba(150,110,255,0)");
    c.fillStyle = fgr;
    c.beginPath(); c.arc(fp.x,fp.y,flr,0,6.28318); c.fill();
  }
  /* {B} IT LANDS ON THE SHELL, NOT IN HIS FACE {B}
     The ray ran to W.x,W.y - his CENTRE - so it crossed the knotwork and the
     head and terminated somewhere behind his nose, which reads as the beam
     passing through him rather than hitting him. His ring is the armour and it
     is the thing being cut, so the line stops on its outer edge and the impact
     sits where the damage is actually being done. */
  /* ════════════════════ IT SHEARS ACROSS THE SHELL, IT DOES NOT JUST STOP ════════════════════
     Two problems with the old ray: it ran to W.x,W.y - his CENTRE - so it
     crossed the knotwork and terminated behind his nose, and it was a flat
     lavender line with a white line on top of it, which is a laser from a
     placeholder. A beam that ends in a soft dot reads as being ABSORBED. This
     one is supposed to be four keno tiles cutting at a shield that is holding.

     So it lands on the rim and then WRAPS. Two arcs run off the contact point
     around the curve of his shell, brightest where the beam meets it and dying
     away as they travel - the light being turned by a surface it cannot get
     through. That is what makes it read as shearing rather than as landing.

     The beam itself gets three passes and a flicker: a wide soft bloom, the
     body, and a white core whose width breathes frame to frame so it looks
     like something under load rather than a drawn rectangle. Embers come off
     the contact along the tangent - along the shell, not back down the beam -
     because that is the direction material actually leaves a cut.

     ALL OF IT IS COSMETIC. The damage is padDPS() on a timer and does not know
     any of this exists. */
  var wdt = 6 + k*5.5;
  var rda = Math.atan2(W.y-fp.y, W.x-fp.x), rdr = walkerR()*0.99;
  var hitx = W.x - Math.cos(rda)*rdr, hity = W.y - Math.sin(rda)*rdr;
  var flick = 0.86 + 0.14*Math.sin(now*0.045) * Math.sin(now*0.017);

  /* the bloom */
  c.strokeStyle = "rgba(150,110,255,.30)"; c.lineWidth = wdt*2.1;
  c.beginPath(); c.moveTo(fp.x,fp.y); c.lineTo(hitx,hity); c.stroke();
  /* the body */
  c.strokeStyle = "rgba(190,150,255,.80)"; c.lineWidth = wdt;
  c.beginPath(); c.moveTo(fp.x,fp.y); c.lineTo(hitx,hity); c.stroke();
  /* the core, breathing */
  c.strokeStyle = "rgba(255,252,255,.97)"; c.lineWidth = wdt*0.34*flick;
  c.beginPath(); c.moveTo(fp.x,fp.y); c.lineTo(hitx,hity); c.stroke();

  /* ════════════════════ THE WRAP ════════════════════
     Arcs along the shell either side of the contact, fading as they go. Drawn
     as a handful of short segments rather than one stroke so each can carry its
     own alpha - a single arc with a gradient cannot fade along its own path. */
  /* {B} FOUR TILES CUT FOUR TIMES AS FAR AROUND HIM {B}
     The wrap used to widen by a tenth of a radian per tile - 0.72 to 1.02,
     which is barely a difference and made one lit tile look very much like
     four. It is the only picture of the damage staircase there is, and the
     staircase is anything but linear: x1, x2.6, x4.8, x7.6.

     So the arc scales properly. One tile smears a little light either side of
     the contact; four tiles have the cut running most of the way round the
     shell, brighter and thicker with it. The number of segments goes up too, or
     the longer arc gets visibly faceted. */
  var hitA = Math.atan2(hity-W.y, hitx-W.x);
  var spread = 0.34 + 0.30*k;                 /* 0.64 rad at one tile, 1.54 at four */
  var segs = 6 + k*3;
  var punch = 0.55 + 0.16*k;                  /* and it burns brighter with them */
  for (var wi=0; wi<segs; wi++){
    var t0 = wi/segs, t1 = (wi+1)/segs;
    for (var sgn=-1; sgn<=1; sgn+=2){
      var a0 = hitA + sgn*spread*t0, a1 = hitA + sgn*spread*t1;
      var fade = Math.pow(1 - t0, 2.0);
      c.strokeStyle = "rgba(214,180,255," + Math.min(1, punch*fade*flick).toFixed(3) + ")";
      c.lineWidth = (wdt*0.55) * (1 - t0*0.72);
      c.beginPath(); c.arc(W.x, W.y, rdr, a0, a1, sgn < 0); c.stroke();
      c.strokeStyle = "rgba(255,250,255," + Math.min(1, (punch*0.78)*fade*flick).toFixed(3) + ")";
      c.lineWidth = (wdt*0.22) * (1 - t0*0.78);
      c.beginPath(); c.arc(W.x, W.y, rdr, a0, a1, sgn < 0); c.stroke();
    }
  }

  /* the contact itself */
  var hg = c.createRadialGradient(hitx,hity,0,hitx,hity,wdt*2.9);
  hg.addColorStop(0,"rgba(255,255,255,.92)");
  hg.addColorStop(0.35,"rgba(214,180,255,.50)");
  hg.addColorStop(1,"rgba(150,110,255,0)");
  c.fillStyle = hg;
  c.beginPath(); c.arc(hitx,hity,wdt*2.9,0,6.28318); c.fill();

  /* {B} SHEARED OFF A TURNING WHEEL {B}
     More tiles throw more material, and it leaves along the TANGENT rather than
     back down the beam - that is the direction it actually comes off a cut.

     And it inherits the shell's own motion: W.spin * rdr is the surface speed
     of his ring at the contact, so the debris is flung the way the wheel is
     turning. During a nova wind-up, when he is spinning up to two turns a
     second, the spray visibly whips round with him. That is the detail that
     makes it read as being scraped off something ROTATING rather than as sparks
     at a fixed point. */
  var surf = W.spin * rdr, ember = 1 + k;
  for (var eq=0; eq<ember; eq++){
    if (Math.random() > 0.30 + 0.13*k) continue;
    var side = (Math.random()<0.5?1:-1);
    var tang = hitA + 1.5708*side;
    var spd2 = 110 + Math.random()*(140 + 60*k);
    addSpark(hitx, hity,
             Math.cos(tang)*spd2 - Math.sin(hitA)*surf*0.45 + (Math.random()-0.5)*70,
             Math.sin(tang)*spd2 + Math.cos(hitA)*surf*0.45 + (Math.random()-0.5)*70,
             0.26 + Math.random()*0.32, 1, 0.25);
  }
  c.globalCompositeOperation = "source-over";
  F.hitPt = { x:hitx, y:hity };
}

/* ════════════════════ THERE IS NO PHASE TAG ANY MORE ════════════════════
   It was a box in the corner reading PHASE n/8 with the hotkeys under it, and
   it existed because eight phases that differ by which moves he has all look
   broadly alike from the outside. That was true while the phase model was being
   BUILT. It is not true now: his colour walks the rainbow, the bar walks with
   him, the ring is whole or gone, and the tiles are lit or dark - between them
   the arena says which phase it is without a caption.

   The hotkeys went with it. Backtick, shift+enter and I are three keys a tester
   learns once, and a permanent legend for them is a permanent piece of
   furniture over the top-left of the arena. */
function drawHUD(c){
  if (!F.on) return;
  var w = VW(), total = poolTotal(), left = poolLeft();
  var frac = left/total;
  /* THE WHOLE BAR GOES HOT WHILE THE SHIELD IS OFF and sits dull while it is
     on. These two colours used to be two REGIONS of a bar that was more than
     half shield; the shield is not a region any more, so they say the one
     thing still worth saying at a glance - can I hurt him right now. */
  var vuln = F.brk ? 1 : 0;

  if (F.ghost === undefined || F.ghost < frac) F.ghost = frac;
  F.ghost += (frac - F.ghost) * Math.min(1, DT*3.2);

  /* BIG ENOUGH TO PUT A NAME IN. 30px tall was a status bar; the name lives
     INSIDE it now, so the bar has to be the size of the type rather than the
     type being squeezed under the bar. */
  var bw = Math.min(980, w*0.72), bx = (w-bw)/2, by = 34, bh = 46;

  /* GRIM, NOT ARCADE. The first pass was a bright red bar with a gloss
     highlight along the top — which is a health bar from a cartoon, and it sat
     over a starfield and a demonic sheep looking like a loading screen. What
     changed: the reds are desaturated toward dried blood and rust, the gloss is
     gone entirely, the plate is nearly black, and the frame is a thin hard line
     instead of a glow. Nothing here is lit; it is stained. */
  c.fillStyle = "rgba(3,3,4,.92)";
  c.fillRect(bx-8, by-8, bw+16, bh+16);
  c.strokeStyle = "rgba(96,88,84,.40)"; c.lineWidth = 1;
  c.strokeRect(bx-8.5, by-8.5, bw+17, bh+17);

  c.fillStyle = "#0b0708"; c.fillRect(bx, by, bw, bh);

  /* the ghost is bone, not pink — it is what is left of him, not a highlight */
  c.fillStyle = "rgba("+hx("150,136,128")+",.30)";
  c.fillRect(bx, by, bw*F.ghost, bh);

  /* the live bar, in two colours — dull where he is still shielded, hot where
     he is not. Clipped rather than drawn as two rects so the boundary between
     them is exact at every value. */
  c.save();
  c.beginPath(); c.rect(bx, by, bw*frac, bh); c.clip();
  /* shielded: rust over dried blood. exposed: raw, but still not bright. */
  /* {B} FLAT, AND IT TRIPS WITH HIM {B}
     Two problems in one fill. It was a three-stop vertical gradient with a
     shadow banded across the bottom - the shadow was put there to REPLACE a
     gloss highlight, but a light-to-dark-to-light ramp down the height of a bar
     is itself the thing that reads as a moulded plastic tube, so removing the
     shine and leaving the ramp did not remove the plastic.

     And it was the last thing on screen still painted in fixed hex while his
     art, his sparks, his telegraphs and the safe wedge all descend the rainbow
     together - so at break 4 the arena was violet and his bar was still rust.
     Both halves run through hx() now: dull where the shield is up, hot where it
     is down, and both of them his colour at that moment. */
  var deep = c.createLinearGradient(0, by, 0, by+bh);
  deep.addColorStop(0,"rgba("+hx("64,20,17")+",1)");
  deep.addColorStop(1,"rgba("+hx("44,13,11")+",1)");
  c.fillStyle = deep; c.fillRect(bx + bw*vuln, by, bw*(1-vuln), bh);
  var hot = c.createLinearGradient(0, by, 0, by+bh);
  hot.addColorStop(0,"rgba("+hx("150,28,22")+",1)");
  hot.addColorStop(1,"rgba("+hx("112,16,13")+",1)");
  c.fillStyle = hot; c.fillRect(bx, by, bw*vuln, bh);
  /* AND NO SHADOW EITHER. The bottom band was the gloss trick upside down and
     it did the same job - it gave the bar a rounded cross-section. A boss bar
     wants to look like a quantity, not like an object. One faint line along the
     top edge instead, which reads as an inset rather than as a shape. */
  c.fillStyle = "rgba(0,0,0,.28)"; c.fillRect(bx, by, bw*frac, 1.5);
  c.restore();

  /* ════════════════════ THE NOTCHES ARE THE GATES, AND THEY ARE NOT EVENLY SPACED ════════════════════
     A break ends where its notch is, and because each one eats a bigger bite
     at a higher rate than the last, the marks crowd toward the right. That
     shape is the fight: the bar barely moves while you own one tile and falls
     off a cliff while you own four. Without the marks the first break reads as
     "I am accomplishing nothing" for its entire length, which is the one thing
     a boss bar exists to prevent. */
  c.strokeStyle = "rgba(0,0,0,.9)"; c.lineWidth = 3;
  for (var i=1;i<PAD_FORCE;i++){
    var nx = bx + bw*GATE[i];
    c.beginPath(); c.moveTo(nx, by); c.lineTo(nx, by+bh); c.stroke();
  }
  /* and the one you are working toward, lit only while it is live */
  if (F.brk){
    var vx = bx + bw*GATE[F.brk];
    c.strokeStyle = "rgba(225,205,190,.80)"; c.lineWidth = 2;
    c.beginPath(); c.moveTo(vx, by-4); c.lineTo(vx, by+bh+4); c.stroke();
  }

  c.strokeStyle = "rgba(126,116,110,.55)"; c.lineWidth = 1;
  c.strokeRect(bx-0.5, by-0.5, bw+1, bh+1);

  /* THE NAME SITS IN THE BAR, not above it. Above, it was a caption on a
     status readout; inside, the bar IS the nameplate — which is what a boss bar
     is for, and what was asked for twice.

     WHITE FILL, HEAVY BLUE OUTLINE, drawn stroke-first so the outline sits
     BEHIND the fill. A stroke painted on top of a fill always eats inward and
     thins the letterforms; two passes — a near-black spread underneath and the
     blue over it — give the hard double edge the reference has. */
  c.textAlign = "center"; c.textBaseline = "middle";
  c.font = NAME_FONT;
  c.lineJoin = "round"; c.miterLimit = 2;
  var ny = by + bh/2 + 1;
  /* ════════════════════ PURPLE, AND IT DOES NOT TRIP WITH HIM ════════════════════
     The heavy outline was #2f4fd8, a flat blue that belonged to nothing else on
     the screen. Purple is his - it is what his Discord name is, and the ring
     around his avatar with it.

     Deliberately NOT run through hx(). Everything else he owns descends the
     rainbow, but a name is an identity rather than a state: if it went green at
     break 2 and blue at break 3 it would stop being his name and start being
     another readout of the phase, which the bar behind it is already giving. */
  c.strokeStyle = "#05050c"; c.lineWidth = 13; c.strokeText(BOSS_NAME, w/2, ny);
  c.strokeStyle = "#7c3aed"; c.lineWidth = 7;  c.strokeText(BOSS_NAME, w/2, ny);
  c.fillStyle   = "#ffffff";                   c.fillText(BOSS_NAME, w/2, ny);
  c.textBaseline = "alphabetic";

  if (!shieldLeft()){
    c.font = "700 13px ui-monospace,Consolas,monospace";
    /* it pulses, because it is the one moment in the fight that changes what
       you should be doing */
    var pl = 0.45 + 0.35*Math.sin(F.t/220);
    c.fillStyle = "rgba(176,150,142,"+pl.toFixed(3)+")";
    c.fillText("SHIELD DOWN", w/2, by+bh+22);
  }

  /* {B} FIVE BOXES AND ONE BOMB {B}
     It was a 240x9 continuous bar and a row of little pips, both of which make
     you ESTIMATE. Every source of damage costs exactly one fifth of you, so the
     only question the readout has to answer is "how many more can I take" - and
     that is a countable thing, so it is drawn as countable boxes. The one you
     are about to lose is the one on the right; a partial fills proportionally,
     so nothing is hidden if a future source ever chips.

     THE BOMB IS NOT A PIP ANY MORE. There is only ever one, and it is the single
     most consequential key in the fight - it deserves to be the size of a
     decision rather than a dot in a row. Lit and ringed while you hold it,
     hollow and grey the moment it is spent, and the word underneath either way
     so it is never a mystery symbol. */
  /* ════════════════════ READOUT 3 ════════════════════
     One bevelled plate holding both, with the mines stacked VERTICALLY at the
     right - so the block is the same width whether you hold one or four, and
     the row of boxes never shifts under your eye when a tile pays out. That is
     the whole argument for the vertical stack: a readout you glance at during a
     bullet hell must not move.

     The label says HEALTH, not HITS. "Hits" is what the DESIGNER calls the unit
     because every source costs exactly one; the player just wants to know how
     much of them is left. Set larger, letter-spaced and above the plate rather
     than crammed inside it. */
  var segN = HITS_TO_DIE, segW = 52, segH = 16, segGap = 4;
  var hpW2 = segN*segW + (segN-1)*segGap;
  /* ════════════════════ THE MINES LIE IN A ROW ════════════════════
     They were stacked vertically so the plate stayed one width whether you held
     one or four - a readout you glance at mid-bullet-hell should not move. It
     was the wrong trade: four diamonds in a column are taller than the plate,
     so the top one collided with its own SHIFT label, and a column of pips does
     not read as a COUNT the way a row does. A row it is, and the plate is
     allowed to grow with it. */
  var bmax = bombMax(), bd = 18, bgap = 6;
  var brow = bmax ? bmax*bd + (bmax-1)*bgap : 0;
  var blockW = hpW2 + (bmax ? 30 + brow : 0);
  /* ════════════════════ HARD INTO THE BOTTOM-RIGHT CORNER ════════════════════
     Centred at the bottom it sat directly under the arena, and by the finale
     the sweep pushes the player into the bottom-LEFT - so the one readout they
     need was competing for the same corner of their attention as the thing
     keeping them alive. The right-hand side is outside the play wall at 0.66
     anyway: nothing is ever there to be covered. */
  var mx = w - blockW - 24, my = VH()-40;
  var hpLeft = F.hpM/F.hpMmax*segN;

  var pg = c.createLinearGradient(0, my-13, 0, my+segH+17);
  pg.addColorStop(0,"rgba(16,16,24,.95)"); pg.addColorStop(1,"rgba(6,6,10,.95)");
  c.fillStyle = pg;
  c.fillRect(mx-15, my-13, blockW+30, segH+30);
  c.strokeStyle = "rgba(120,132,128,.35)"; c.lineWidth = 1;
  c.strokeRect(mx-15.5, my-13.5, blockW+31, segH+31);

  for (var sgi=0; sgi<segN; sgi++){
    var sx3 = mx + sgi*(segW+segGap), fill = Math.max(0, Math.min(1, hpLeft - sgi));
    c.fillStyle = "#0e1a14";
    c.fillRect(sx3, my, segW, segH);
    if (fill > 0){
      /* the last one you have left runs hot, so "one hit from dead" is a colour
         rather than a count you do while dodging */
      var last = (Math.ceil(hpLeft) === sgi+1) && hpLeft <= 1.001;
      var g3 = c.createLinearGradient(0, my, 0, my+segH);
      if (last){ g3.addColorStop(0,"#ff8f6b"); g3.addColorStop(1,"#c8341c"); }
      else     { g3.addColorStop(0,"#7dffb0"); g3.addColorStop(1,"#2ba465"); }
      c.fillStyle = g3;
      c.fillRect(sx3, my, segW*fill, segH);
      c.fillStyle = "rgba(0,0,0,.22)";
      for (var nn=1; nn<3; nn++) c.fillRect(sx3 + segW*nn/3 - 0.5, my, 1, segH);
    }
    c.strokeStyle = fill > 0 ? "rgba(190,255,220,.55)" : "rgba(110,125,120,.35)";
    c.lineWidth = 1;
    c.strokeRect(sx3+0.5, my+0.5, segW-1, segH-1);
  }

  c.font = "700 12px ui-monospace,Consolas,monospace";
  c.textAlign = "left"; c.textBaseline = "alphabetic";
  c.fillStyle = "rgba(190,225,208,.92)";
  c.fillText("H E A L T H", mx, my-20);

  if (bmax){
    var bx0 = mx + hpW2 + 30 + bd/2;
    for (var bq=0; bq<bmax; bq++){
      var bxc = bx0 + bq*(bd+bgap), byc = my + segH/2;
      c.save(); c.translate(bxc, byc); c.rotate(0.7854);
      var bs2 = bd*0.66;
      if (bq < F.bombs){
        var bg2 = c.createLinearGradient(-bs2/2,-bs2/2,bs2/2,bs2/2);
        bg2.addColorStop(0,"#dff4ff"); bg2.addColorStop(0.55,"#6cc4f5"); bg2.addColorStop(1,"#1d5f8c");
        c.fillStyle = bg2; c.fillRect(-bs2/2,-bs2/2,bs2,bs2);
        c.strokeStyle = "rgba(215,245,255,.95)"; c.lineWidth = 2;
        c.strokeRect(-bs2/2,-bs2/2,bs2,bs2);
      } else {
        c.strokeStyle = "rgba(110,125,140,.5)"; c.lineWidth = 2;
        c.strokeRect(-bs2/2,-bs2/2,bs2,bs2);
      }
      c.restore();
    }
    c.textAlign = "center";
    c.fillStyle = F.bombs > 0 ? "rgba(200,235,255,.9)" : "rgba(110,125,140,.6)";
    c.fillText("SHIFT", bx0 + (brow-bd)/2, my-20);
  }

  c.font = "700 11px ui-monospace,Consolas,monospace";
  c.textAlign="center";
  c.font="700 11px ui-monospace,Consolas,monospace";
  /* NO TILES-LIT LINE, NO DPS. Both are numbers about a system rather than
     about the next second: the lit tiles are already four glowing squares
     feeding a visible ray, and DPS is a figure you can do nothing with while
     dodging. The bar moving is the only damage readout the player needs. */
  c.textAlign="left";
  c.textAlign = "center";

  if (rewinding){
    c.font = '400 40px "Archivo Black","Arial Black",Impact,sans-serif';
    c.lineJoin="round";
    c.strokeStyle="#06060f"; c.lineWidth=13;
    c.strokeText("REWINDING", w/2, VH()*0.40);
    c.fillStyle="#a8dcff"; c.fillText("REWINDING", w/2, VH()*0.40);
    c.font="700 12px ui-monospace,Consolas,monospace";
    c.fillStyle="#7f9ab0";
    c.fillText(Math.max(0, rewindPos/REWIND_FPS).toFixed(1)+"s BACK", w/2, VH()*0.40+28);
  }

  if (F.over){
    c.font = '400 44px "Archivo Black","Arial Black",Impact,sans-serif';
    c.lineJoin = "round";
    c.strokeStyle = "#08080f"; c.lineWidth = 14;
    c.strokeText(F.over==="player" ? "WALKER DOWN" : "YOU DIED", w/2, VH()*0.42);
    c.fillStyle = F.over==="player" ? "#7dffb0" : "#ff6b4b";
    c.fillText(F.over==="player" ? "WALKER DOWN" : "YOU DIED", w/2, VH()*0.42);
    /* ════════════════════ WHAT YOU DO NEXT, AT THE SIZE YOU DO IT ════════════════════
       "press ESC to leave the arena" was the only instruction on a death
       screen whose entire purpose is to get you back in - so the retry is the
       line that gets the weight, drawn in the same face as YOU DIED with the
       same dark outline so it survives a floor covered in bullets. ESC still
       works; it does not need announcing. */
    var dy = VH()*0.42;
    c.font = '400 27px "Archivo Black","Arial Black",Impact,sans-serif';
    c.strokeStyle = "#08080f"; c.lineWidth = 10;
    c.strokeText("PRESS SHIFT+ENTER TO RETRY", w/2, dy+46);
    c.fillStyle = "#ffd36b";
    c.fillText("PRESS SHIFT+ENTER TO RETRY", w/2, dy+46);
    /* the tally, big enough to read across the room */
    if (F.over !== "player"){
      var dn = F.deaths || deathCount();
      c.font = '700 19px ui-monospace,Consolas,monospace';
      c.strokeStyle = "#08080f"; c.lineWidth = 7;
      c.strokeText("DEATHS   " + dn, w/2, dy+82);
      c.fillStyle = "#e2b9ae";
      c.fillText("DEATHS   " + dn, w/2, dy+82);
    }
  }
}
function nextSeg(){ for (var i=0;i<SEGS;i++) if (F.broken.indexOf(i)<0) return i; return -1; }

/* ── the intro ─────────────────────────────────────────────────────────── */
var BEATS = [
  { id:"approach", ms:2600 },
  { id:"greet", ms:3800, pad:400, clip:"greeting", who:"walker", cls:"walker",
    text:"good day my friend, do you want to see my crazy time win?" },
  /* THE SPEAKER IS "you", NOT A CHARACTER. The line was Mih's when Mih was the
     player; the player is now a piece of the board, and a keno tile does not
     have a name to put here. */
  { id:"reply", ms:2800, who:"you", cls:"you",
    text:"hey! I think I know you! you are Mcwalker right?" },
  { id:"recoil", ms:1600 },
  { id:"rage", ms:3340, pad:400, clip:"whatdidyousay", demonic:true,
    who:"mcwalker", cls:"demon", text:"WHAT DID YOU SAY TO ME YOU FILTHY CUNT" },
  { id:"spin", ms:2600 },
  { id:"ram", ms:1200 }
];
var CLOCK=0, bi=-1, beatStart=0, playing=false, typed=0, lastBlip=0;
var bangAt=0, BANG_DELAY=320;
function ease(t){ return t<0.5 ? 4*t*t*t : 1-Math.pow(-2*t+2,3)/2; }

function nextBeat(){
  bi++;
  if (bi>=BEATS.length){ playing=false; hideSubs(); return; }
  var b=BEATS[bi]; beatStart=CLOCK; typed=0;
  if (b.text){
    $("bossSubs").className="on";
    $("bossWho").className="who "+b.cls; $("bossWho").textContent=b.who;
    $("bossLine").className="line"+(b.cls==="demon"?" demon":""); $("bossLine").textContent="";
  } else hideSubs();
  if (b.clip) voicePlay(b.clip, b.demonic);
  bangAt = (b.id==="recoil") ? CLOCK+BANG_DELAY : 0;
  if (b.id!=="recoil" && b.id!=="reply") hideBang();
  if (b.id==="rage") knock(70,40,0.7,0.22);
  if (b.id==="ram"){
    knock(120,32,0.9,0.34); W.shake=1;
    var bb=boardBox();
    shatterBoard(); burst(bb.x,bb.y,90,620); playerReveal(); fightStart();
    if (MUSIC && !muted()){ var mp=MUSIC.play(); if (mp&&mp.catch) mp.catch(function(){}); }
  }
}
function hideSubs(){ var e=$("bossSubs"); if (e) e.className=""; }
function showBang(){
  var e=$("bang"); if (!e) return;
  e.classList.remove("off","on"); void e.offsetWidth; e.classList.add("on");
  knock(680,300,0.09,0.15);
}
function hideBang(){ var e=$("bang"); if (e){ e.classList.remove("on"); e.classList.add("off"); } }
function typeOut(b, now){
  var per=b.ms*0.6/b.text.length;
  var want=Math.min(b.text.length, Math.floor((now-beatStart)/per));
  if (want>typed){
    for (var i=typed;i<want;i++){
      var ch=b.text[i];
      /* no blips over a real take — the understudy does not go on when the
         actor is there. Mih has no recording, so Mih still blips. */
      if (!b.clip && ch!==" " && now-lastBlip>26){ blip(ch); lastBlip=now; }
    }
    typed=want;
  }
  $("bossLine").textContent = b.text.slice(0,typed);
}
function introStep(now){
  if (!playing) return;
  var b=BEATS[bi], p=Math.min(1,(now-beatStart)/b.ms), rest=restPos();
  if (b.id==="approach"){
    var e=ease(p), y0=-WALK*0.75;
    W.scale=0.45+0.55*e; W.x=rest.x; W.y=y0+(rest.y-y0)*e;
    W.spin=1.80*(1-e)+0.24;
  } else if (b.id==="greet" || b.id==="reply"){
    W.y=rest.y+Math.sin(now/700)*5; W.spin=0.24;
  } else if (b.id==="recoil"){
    if (bangAt && now>=bangAt){ bangAt=0; showBang(); }
    W.y-=1.1; W.scale+=(0.86-W.scale)*0.05;
    var rate=5+26*p;
    W.demon=(Math.floor((now-beatStart)/(1000/rate))%2)?1:0;
    if (p>0.88) W.demon=1;
  } else if (b.id==="rage"){
    if (p>0.12) hideBang();
    W.demon=1; W.scale+=(0.94-W.scale)*0.06; W.y+=Math.sin(p*Math.PI*3)*1.2;
  } else if (b.id==="spin"){
    W.demon=1; W.spin=Math.min(0.26,W.spin+0.0055); W.scale+=(1.02-W.scale)*0.05;
    W.y-=0.5;
    aoeSparks(DT, 900+5600*p);
  } else if (b.id==="ram"){
    W.demon=1;
    var hit=boardBox().y;
    if (p<0.3) W.y+=(hit-W.y)*0.5; else { W.y+=(rest.y-W.y)*0.10; W.spin*=Math.pow(0.93,DT*60); }
    W.shake=Math.max(0,1-p*2.2);
  }
  W.ang = wrapAng(W.ang + W.spin * DT);
  if (b.text) typeOut(b, now);
  if (p>=1) nextBeat();
}

/* ── loop ──────────────────────────────────────────────────────────────── */
var raf=null, lastPaint=0, DT=0.016, live=false;
function frame(now){
  if (!live){ raf=null; return; }
  raf = requestAnimationFrame(frame);
  DT = lastPaint ? Math.min(0.05,(now-lastPaint)/1000) : 0.016;
  lastPaint = now;
  CLOCK = now;

  qualityStep(DT);
  musicStep();
  drawStars();
  introStep(now);
  /* FROZEN MEANS THE SIMULATION, NOT THE SCREEN. Everything below still paints,
     so the panel is dragged against a still frame of the thing being tuned. */
  if (!DEVPAUSE.on){
    fightStep(DT, now);
    sparkStep(DT); shardStep(DT); playerStep(DT);
  }

  var el=$("walker");
  if (el){
    var sh = W.shake ? (Math.random()-0.5)*16*W.shake : 0;
    el.style.transform="translate("+(W.x-WALK/2)+"px,"+(W.y-WALK/2+sh)+"px) scale("+W.scale.toFixed(3)+")";
    var bg=$("bang");
    if (bg) bg.style.fontSize=(44/Math.max(0.35,W.scale)).toFixed(1)+"px";
  }
  paintWalker();

  decayFx(DT);
  var cv=$("bossFx");
  if (cv){
    var dp2=DPR(), fw=Math.round(VW()*dp2), fh=Math.round(VH()*dp2);
    if (cv.width!==fw||cv.height!==fh){ cv.width=fw; cv.height=fh; }
    var c=cv.getContext("2d");
    c.setTransform(1,0,0,1,0,0);
    c.clearRect(0,0,cv.width,cv.height);
    c.setTransform(dp2,0,0,dp2,0,0);

    c.save();
    if (SHAKE > 0){
      var k2 = SHAKE*SHAKE*13;
      c.translate((Math.random()-0.5)*k2, (Math.random()-0.5)*k2);
    }
    c.globalCompositeOperation="lighter";
    sparkDraw(c); fightDraw(c);
    c.globalCompositeOperation="source-over";
    /* SOURCE-OVER, NOT `lighter`. He is a dark tile with a light edge; drawn
       additively the dark body simply would not exist. */
    drawPads(c, CLOCK);
    drawBullets(c);
    drawShocks(c);
    finDraw(c);
    dmgNumDraw(c);
    lootDraw(c);
    drawPlayer(c);
    c.restore();

    /* the flash sits over everything and under the HUD — a readout that strobes
       with the fight is a readout you stop reading */
    /* A VIGNETTE, NOT A WASH. A flat fill over the whole canvas tinted every
       bullet, every spark and the starfield with it — the screenshot of a
       blocked fireblast came back with the entire arena dark green. Pushing the
       colour to the EDGES leaves the middle, where the player and everything
       they have to read actually are, untouched. */
    if (FLASH > 0){
      var cx=cv.width/2, cy=cv.height/2, rad=Math.hypot(cx,cy);
      var vg=c.createRadialGradient(cx,cy,rad*0.35,cx,cy,rad);
      vg.addColorStop(0,"rgba("+FLASH_HUE+",0)");
      vg.addColorStop(1,"rgba("+FLASH_HUE+","+(FLASH*0.55).toFixed(3)+")");
      c.fillStyle=vg; c.fillRect(0,0,cv.width,cv.height);
    }
    drawHUD(c);
  }
}

/* ── keys ──────────────────────────────────────────────────────────────── */
/* CLEARED IN PLACE, NEVER REASSIGNED. `keys = {}` reads as the same thing and
   is not: every holder of the old object keeps holding it. The keydown handler
   closes over the variable so it followed the swap, but `Boss.keys` is a
   snapshot taken at export time — so anything driving the fight from outside
   was writing into an object nothing reads any more. It cost a whole balance
   run, which reported a player who never fired a shot. */
/* ════════════════════ A TUNING PANEL, BECAUSE THESE ARE ARGUMENTS NOT FACTS ════════════════════
   Every number in TUNE has been changed at least once by someone watching the
   fight and saying "that is too fast", and every one of those cost a code
   change, a redeploy and a cache bust to try. Backtick freezes the arena and
   opens sliders straight into TUNE. Drag, unfreeze, watch, repeat - and when a
   number is right, read it off the panel and it gets baked into TUNE.

   IT PAUSES BY SKIPPING THE STEPS, NOT BY ZEROING dt. The patterns fire off a
   monotonic clock rather than off dt, so a frozen dt would have left them
   firing into a still arena; and the same clock means every stamp has to be
   pushed forward on resume or the whole table comes due at once and the room
   fills in a frame. */
var DEVPAUSE = { on:false, at:0, el:null };

var TUNE_SPEC = [
  ["aimed",    "aimed",           60,  600,   5],
  ["aimEvery", "aimed gap (ms)",  100, 1200,  10],
  ["aimWave",  "aimed weave (px/s)",0,  500,  10],
  ["aimWaveHz","aimed weave (Hz)",  0,    2, 0.05],
  ["fan",      "fan",             60,  600,   5],
  ["fanW",     "fan width (px)",  120,  900,  10],
  ["fanRows",  "fan rows in air",   1,    6,   1],
  ["ring",     "ring",            40,  400,   5],
  ["spiral",   "spiral arms",     40,  400,   5],
  ["counter",  "counter arms",    40,  400,   5],
  ["padCharge","tile charge (ms)",2000,25000, 250],
  ["moveGap",  "rest between moves",0.15, 1.5, 0.05],
  ["novaOrbEvery","nova orbs (ms apart)",60, 700,  10],
  ["mainRush", "main: first cycle gap",300, 4000, 100],
  ["mainRest", "main: later gap",       500, 7000, 100],
  ["runeTell", "rune wind-up",   400, 5000,  50],
  ["aoeTell",  "shower wind-up", 400, 6000,  50],
  ["novaTell", "nova charge",    400, 5000,  50]
];

/* the three wind-ups are read from their own vars all over the step, so the
   panel writes both and they can never disagree */
function tuneApply(){
  PAD_CHARGE_MS = TUNE.padCharge;
  RUNE_CHARGE = TUNE.runeTell;
  AOE_WIND    = TUNE.aoeTell;
  NOVA_TELL   = TUNE.novaTell;
}

function tunePanel(){
  if (DEVPAUSE.el) return DEVPAUSE.el;
  var d = document.createElement("div");
  d.style.cssText = "position:fixed;top:14px;right:14px;z-index:99999;width:280px;" +
    "background:rgba(6,6,10,.94);border:1px solid rgba(150,140,135,.45);" +
    "padding:12px 14px;font:600 12px ui-monospace,Consolas,monospace;color:#cec6c0;" +
    "max-height:88vh;overflow:auto";
  var html = '<div style="color:#ffd36b;font-size:13px;margin-bottom:8px">' +
             'TUNING &nbsp;<span style="color:#8a827c">` to resume</span></div>';
  for (var i=0;i<TUNE_SPEC.length;i++){
    var t = TUNE_SPEC[i];
    html += '<div style="margin:7px 0">' +
      '<label style="display:flex;justify-content:space-between">' +
      '<span>'+t[1]+'</span><b id="tv_'+t[0]+'" style="color:#ffb08a">'+TUNE[t[0]]+'</b></label>' +
      '<input id="ts_'+t[0]+'" type="range" min="'+t[2]+'" max="'+t[3]+'" step="'+t[4]+
      '" value="'+TUNE[t[0]]+'" style="width:100%">' +
      '</div>';
  }
  html += '<div id="tuneDump" style="margin-top:10px;color:#8a827c;' +
          'word-break:break-all;line-height:1.45"></div>';
  d.innerHTML = html;
  document.body.appendChild(d);
  function dump(){
    var parts = [];
    for (var j=0;j<TUNE_SPEC.length;j++){ var k=TUNE_SPEC[j][0]; parts.push(k+":"+TUNE[k]); }
    var el = d.querySelector("#tuneDump");
    if (el) el.textContent = parts.join(", ");
  }
  for (var i2=0;i2<TUNE_SPEC.length;i2++){
    (function(key){
      var sl = d.querySelector("#ts_"+key), lab = d.querySelector("#tv_"+key);
      sl.addEventListener("input", function(){
        TUNE[key] = +sl.value; lab.textContent = sl.value; tuneApply(); dump();
      });
      /* the arena eats WASD and space; a slider that has focus would too */
      sl.addEventListener("keydown", function(ev){ ev.stopPropagation(); });
    })(TUNE_SPEC[i2][0]);
  }
  dump();
  DEVPAUSE.el = d;
  return d;
}

function devPauseToggle(now){
  if (typeof DEV === "undefined" || !DEV) return;
  if (!DEVPAUSE.on){
    DEVPAUSE.on = true; DEVPAUSE.at = now;
    tunePanel().style.display = "block";
    clearKeys();
    musicPause();
  } else {
    /* EVERY MONOTONIC STAMP MOVES FORWARD BY THE TIME WE STOOD STILL, or the
       whole pattern table is overdue on the first frame back. */
    var d = now - DEVPAUSE.at;
    for (var i=0;i<patAt.length;i++) patAt[i] += d;
    if (F.clock) F.clock += d;
    if (F.shotAt)  F.shotAt  += d;
    if (F.shotAt2) F.shotAt2 += d;
    if (F.bombAt)  F.bombAt  += d;
    DEVPAUSE.on = false;
    if (DEVPAUSE.el) DEVPAUSE.el.style.display = "none";
    musicResume();
  }
}

/* ════════════════════ SHIFT+ENTER PUTS IT BACK TO PHASE ONE ════════════════════
   Testing a boss means running the same thirty seconds over and over, and the
   way back was ESC, find the dev panel, click Fight, click a phase. This is the
   same two calls the skip-intro path makes - reveal the player, start the
   fight - so it lands in exactly the state a fresh run starts in, including
   the empty arena and all three phase numbers at zero.

   It works from the death screen and from a freeze; a freeze is lifted first,
   or the restart would land in a paused arena and look like nothing happened. */
function restartFight(){
  if (!live) return;
  if (DEVPAUSE.on) devPauseToggle(performance.now());
  clearKeys();
  playerReveal(); fightStart();
  /* a retry starts the score again from the top, like the fight does */
  musicStop();
  if (!muted()){
    try { var mp = MUSIC.play(); if (mp && mp.catch) mp.catch(function(){}); } catch(e){}
  }
}

/* ════════════════════ JUMP TO A PHASE, ON THE NUMBER KEYS ════════════════════
   The old jump row was pulled because it did not behave in play. This is a
   rewrite rather than a revival, and the reason the old one drifted is that it
   set some of the state a phase is and not the rest of it - a phase here is
   SEVEN things, and leaving any of them behind leaves the fight in a position
   it can never reach by playing.

   Odd is a main phase, even is the break after it, so 1..8 reads exactly like
   the fight does. The tiles owned come from n/2, and the health comes from the
   gate the previous break stopped at, which is why the numbers are not round -
   GATE is derived from the superlinear tile damage, not typed in.

   Cleared as well as set: the move in flight, the station it was walking to,
   every shot and shock on screen, the pulse hue, and F.fin - or jumping out of
   the finale leaves an instant-kill line sweeping an arena that is no longer
   in its last phase. */
function devJumpTo(n){
  if (!F.on || n < 1 || n > 8) return;
  var won = Math.floor(n/2), brk = (n % 2 === 0) ? won : 0;
  F.fin = null; F.over = null; bwHide();
  F.won = won; F.brk = brk;
  F.spd = won ? (1 + 0.05*(won-1)) : 1;
  for (var i=0;i<pads.length;i++){
    pads[i].won = i < won; pads[i].on = i < won; pads[i].t = 0;
  }
  F.hpW = F.hpWmax * (brk ? GATE[won-1] : GATE[won]);
  F.hpM = F.hpMmax; F.iframe = 0;
  F.move = null; F.station = null; F.bigEnd = 0; F.pulseAt = 0;
  shots.length = 0; shocks.length = 0;
  pulseHue = 0;
  if (brk){
    F.brkPost = topStation();
    if (brk === PAD_FORCE) finBegin();
  } else {
    F.brkPost = null;
  }
  F.bombs = bombMax();
  if (!P.live) playerReveal();
}

function clearKeys(){ for (var k in keys) delete keys[k]; }

var KEYMAP = { KeyW:"w", KeyA:"a", KeyS:"s", KeyD:"d",
               ArrowUp:"w", ArrowLeft:"a", ArrowDown:"s", ArrowRight:"d",
               Space:"shoot", ShiftLeft:"bomb", ShiftRight:"bomb" };
window.addEventListener("keydown", function(e){
  if (!live) return;
  if (e.code==="Escape"){ bossStop(); return; }
  if (e.code==="Backquote"){ devPauseToggle(performance.now()); e.preventDefault(); return; }
  /* before the freeze guard, so it works while frozen and from the death screen */
  if (e.code==="Enter" && e.shiftKey && typeof DEV !== "undefined" && DEV){
    restartFight(); e.preventDefault(); return;
  }
  if (e.code==="KeyI" && typeof DEV !== "undefined" && DEV){
    GODMODE = !GODMODE; e.preventDefault(); return;
  }
  /* 1..8 jump to a phase. Digit codes only - reading e.key would fire on the
     numpad and on shifted symbols too. */
  if (typeof DEV !== "undefined" && DEV && e.code.indexOf("Digit")===0){
    var dn = +e.code.slice(5);
    if (dn >= 1 && dn <= 8){ devJumpTo(dn); e.preventDefault(); return; }
  }
  if (DEVPAUSE.on) return;              /* the arena is frozen; it gets no input */
  var k=KEYMAP[e.code]; if (!k) return;
  /* fired on the PRESS, not held — a bomb is one decision, not a state */
  if (k==="bomb" && !keys.bomb) useBomb(performance.now());
  keys[k]=true;
  /* swallowed only while the arena is up, so the game's own keys are untouched
     the rest of the time — and space would otherwise scroll the page */
  if (e.code.indexOf("Arrow")===0 || e.code==="Space") e.preventDefault();
});
window.addEventListener("keyup", function(e){ var k=KEYMAP[e.code]; if (k) keys[k]=false; });
/* a key held when the window loses focus never sends its keyup, and he
   accelerates into a wall and stays there */
window.addEventListener("blur", clearKeys);
/* HIS SIZE IS DERIVED FROM THE WINDOW, so it has to be re-derived when the
   window changes — otherwise a resize leaves a boss scaled for a screen that is
   no longer there. */
window.addEventListener("resize", function(){ if (live) sizeWalker(); });

/* ── start / stop ──────────────────────────────────────────────────────── */
function fightStart(){
  /* FIVE SECONDS BEFORE HE DOES ANYTHING. The fight used to start swinging at
     1.1s, on top of a cutscene that had just ended in an explosion. The opening
     seconds belong to the player finding themselves on the screen. */
  /* THE OPENING PAUSE WAS FIVE SECONDS, and it was right when the only way in
     was a cutscene you watched once. With Shift+Enter on the death screen this
     is a room you re-enter every thirty seconds, and five of them staring at an
     empty arena is most of the first tile. Long enough to find yourself on the
     screen, and no longer. */
  F.on=true; F.over=null; F.move=null; F.t=0; F.next=OPEN_PAUSE;
  F.hpW=F.hpWmax; F.hpM=F.hpMmax; F.iframe=0;
  F.repair=0; F.armed=false; F.station=null; F.lock=null;
  /* THE PIECE THAT HIT THE BOARD IS THE PIECE THAT BREAKS. A random segment was
     wrong twice over: it could take a chunk out of the top of him while the
     bottom of him was the part buried in the board, and — because F.broken was
     never cleared on the way IN — the ring arrived at the cutscene already
     carrying the damage from the last fight, so he was visibly chipped before
     he had touched anything.

     Math.PI/2 is straight DOWN in screen coordinates, which is the direction he
     rams. It is also, conveniently, the piece nearest the player for the rest
     of the fight — the first gap you are taught to stand in is the one at the
     bottom of the arena, where you already are. */
  /* THE PIECE THAT BROKE IS THE ONE THAT FACED THE BOARD — still straight down,
     because the ram happens before either of them has taken a side. */
  /* {B} HE ARRIVES WITH HIS SHIELD WHOLE {B}
     This was `[segmentAt(Math.PI/2)]` - the piece that faced the board, taken
     by the intro ram - and it was right when the shield was five segments you
     chipped through one at a time. It is a switch now: whole, or gone. Starting
     a segment down meant he walked in visibly damaged by a mechanic that no
     longer exists, and the ring only ever opens when a tile takes the whole
     thing off. */
  F.broken=[]; F.ghost=undefined;
  /* THE WHOLE PHASE MODEL GOES BACK TO ZERO, and it has to be all three: a
     leftover brk starts the fight already hittable with the ring intact, a
     leftover won puts the escalation at the top with no tiles on the floor,
     and a leftover spd is a silent 15% carried into a fresh run. */
  F.brk=0; F.won=0; F.spd=1; pulseHue=0; F.mvN=0; F.pulseAt=0; F.brkPost=null; F.pulseAt=0; F.fin=null; bwHide();
  F.station = topStation();
  STATS.runs++; statsSave();
  /* ════════════════════ AND HE IS ALREADY THERE ════════════════════
     W is declared at x:0, y:0 and startFight only ever set his DESTINATION, so
     every run began with him at the top-left corner of the world sliding in.
     The patterns do not wait for him to arrive: whatever fired during those
     frames was aimed from off screen, which is bullets appearing out of a
     corner with nothing in it. Putting him on his station is the whole fix. */
  W.x = F.station.x; W.y = F.station.y;
  /* THE FIRING CLOCKS RESET WITH THE FIGHT. Both are "the timestamp of the last
     shot", compared against a monotonic clock — which is safe in play and not
     safe anywhere else. Driven from a test the clock is synthetic and can run
     well ahead of real time, so a second run inherits a stamp from the future
     and silently fires nothing until the wall clock catches up. That produced a
     whole balance table in which the player was disarmed and nobody said so. */
  F.shotAt=0; F.shotAt2=0; patAt=PATTERNS.map(function(){ return 0; }); tapeReset(); F.bigEnd=0; F.dmgBy={}; F.runeHeat=0; F.novaHeat=0; F.aoeGlow=0;
  F.bombs=BOMB_START; F.bombAt=0;
  /* every sequence index goes back to the top, or the second run of the night
     is a different fight from the first */
  spiralA=0; counterA=0; ringIx=0; moveIx=0; stationIx=0; gapIx=0; doorIx=0; boltWalk=0; F.roamAt=0;
  /* ════════════════════ THE ARENA STARTS EMPTY ════════════════════
     shots and shocks were cleared here and sparks and shards were not, so the
     fight opened on the 90-particle burst and the debris from the board coming
     apart - the cutscene's last beat, still playing, over a player who has
     just been given control. Ninety objects moving at once is not a backdrop,
     it reads as the fight having already started without you. The shatter is
     the CUTSCENE's; the fight gets a clean floor. */
  shots=[]; shocks=[]; sparks=[]; shardsClear(); dmgNums=[]; dmgAcc=0; lootMsg=null; buildPads();
  /* AFTER buildPads(), because that is what reads padPower, and his pool is
     derived from it. Both are frozen for the fight here so a purchase between
     phases cannot resize him halfway down the bar. */
  F.hpWmax = walkerPool(); F.hpW = F.hpWmax;
  W.demon=1;      /* dropped when the bolt arrays came out — he arrived white */
}
function fightStop(){
  F.on=false; F.move=null; shots=[]; pads=[];
  rewinding=false; tapeReset(); BOSS_NAME="TheOnlyWalker";
}

function loadAssets(){
  if (artLeft) return;
  artLeft = Object.keys(ART).length;
  Object.keys(ART).forEach(function(k){
    var i=new Image(); i.onload=i.onerror=function(){ artLeft--; }; i.src=ART[k]; IMG[k]=i;
  });
  /* the rage heads start downloading with everything else but gate nothing */
  for (var rq=1; rq<=PAD_FORCE; rq++) rageHead(rq);
  deadHead();

  var a = ac();
  if (a) VOICE.forEach(function(n){
    fetch("../boss/voice/walker_"+n+".mp3")
      .then(function(r){ return r.arrayBuffer(); })
      .then(function(b){ return a.decodeAudioData(b); })
      .then(function(buf){
        BUF[n]=buf;
        /* the beat takes its length from the audio, and the demonic beat from
           the SLOWED audio — rate and duration are the same knob */
        BEATS.forEach(function(bt){
          if (bt.clip===n) bt.ms = (buf.duration/(bt.demonic?DEMON_RATE:1))*1000 + (bt.pad||400);
        });
      }).catch(function(){});
  });
  /* THE FONT HAS TO BE LOADED BEFORE CANVAS WILL USE IT. `font` on a 2d context
     fails silently to the fallback if the face is not resolved yet, and the
     boss bar draws in the first frame — so ask for it on the way in rather than
     hoping it arrived. */
  if (document.fonts && document.fonts.load){
    try { document.fonts.load(NAME_FONT.replace(/^400 34px /, "400 34px ")); } catch(e){}
    try { document.fonts.load('400 44px "Archivo Black"'); } catch(e){}
  }
  if (!MUSIC){
    /* MP3, NOT WAV. The source was 30.9MB of PCM for 160.68 seconds - thirty
       megabytes to download before the fight can start, on a static host, for
       one loop of music. LAME at 160k CBR is 3.2MB for the identical 160.68s.
       Nothing else about the cue changes: still one Audio element decoded up
       front, because the fight's beats are timed off it. The .wav stays on
       disk as the master and is gitignored - it is not something to deploy. */
    /* {B} THE FIRST TRACK DOES NOT LOOP, IT HANDS OVER {B}
       It was `loop = true`, so what "the song running out" actually is is the
       seam - three minutes of build arriving back at bar one with the fight
       two tiles further along than it was. A boss that escalates for four
       minutes cannot be scored by one loop.

       So track one plays once and track two takes over and loops under the
       back half. Two is the one that has to hold: by the time it starts he is
       violet, the counter-arm is out, and the room does not go quiet for his
       own moves any more.

       IF TRACK TWO IS NOT THERE, TRACK ONE LOOPS AS BEFORE. The handover is
       wired off `ended` and a load error just puts the loop back, so dropping
       the file in is the whole install and nothing breaks before it arrives. */
    /* {B} ONE TRACK, LOOPED WITH A CROSSFADE {B}
       Back to the original theme alone. `loop = true` is a BUTT SPLICE - the
       last sample runs straight into the first, and on a track that does not
       end where it begins that is an audible seam every 2m41s, which is what
       "the song runs out" always was.

       Two elements of the same file instead, ping-ponging: the one that is
       playing runs to CROSSFADE_S before its end, at which point the other
       starts from zero and the two are faded across each other. The seam
       becomes an overlap, and nothing in the arena has to know. Both are the
       same file, so there is no second download.

       Driven from frame(), not from a timer - a setInterval keeps firing when
       the tab is hidden and would happily crossfade to a track nobody is
       listening to. */
    MUSIC = new Audio("../boss/music/walker_bossfight.mp3");
    MUSIC.preload="auto"; MUSIC.loop=false; MUSIC.volume=musVol();
    MUSIC2 = new Audio("../boss/music/walker_bossfight.mp3");
    MUSIC2.preload="auto"; MUSIC2.loop=false; MUSIC2.volume=0;
;
  }
}

function bossStart(skipIntro){
  if (live) return;
  loadAssets();
  var a=ac(); if (a && a.state==="suspended") a.resume();
  live=true;
  document.body.classList.add("boss");
  sizeWalker(); makeStars(); makeNebula();

  /* THE GAME STOPS PLAYING ITSELF. play() already refuses while the arena is up,
     which is the guarantee — this is the tidy-up on top of it: without it the
     auto timer keeps firing every second into a gate, and the countdown under
     the board keeps promising a draw that will not come. Held rather than
     cleared, so leaving puts back whatever the player had. */
  /* flat black until there is something to see; the soft vignette only turns up
     once the sky has anything in it to vignette */
  var vl = $("bossVeil");
  if (vl) vl.style.background = skyDepth > 0.02
    ? "radial-gradient(120% 90% at 50% 30%,rgba(8,8,10,.55),rgba(4,4,6,.93))"
    : "#000";
  if (typeof S === "object" && S){
    autoWas = S.autoOn;
    S.autoOn = false;
    if (typeof stopAuto === "function") stopAuto();
  }
  clearKeys(); sparks=[]; shardsClear(); voiceStop();
  /* HE ARRIVES CLEAN. The glow, the rune heat and the nova heat are all left
     wherever the last fight abandoned them, and every one of them draws — so a
     second run's CUTSCENE opened with him already lit for an attack that was
     over minutes ago. Anything that paints has to be cleared on the way in, not
     only on the way into the fight. */
  F.broken=[]; F.on=false;
  F.aoeGlow=0; F.runeHeat=0; F.novaHeat=0;
  W.scale=0.45; W.ang=0; W.spin=0.004; W.demon=0; W.shake=0;
  var r=restPos(); W.x=r.x; W.y=r.y;
  playerHide();
  if (skipIntro){
    playing=false; hideSubs(); hideBang();
    W.scale=1; var b=boardBox();
    shatterBoard(); burst(b.x,b.y,90,620); playerReveal(); fightStart();
    if (MUSIC && !muted()){ var mp=MUSIC.play(); if (mp&&mp.catch) mp.catch(function(){}); }
  } else {
    playing=true; bi=-1; nextBeat();
  }
  lastPaint=0;
  if (!raf) raf=requestAnimationFrame(frame);
}
function bossStop(){
  live=false; playing=false;
  if (DEVPAUSE.on) DEVPAUSE.on = false;
  if (DEVPAUSE.el) DEVPAUSE.el.style.display = "none";
  fightStop(); playerHide(); hideSubs(); hideBang();
  shardsClear(); sparks=[]; voiceStop();
  musicStop();
  window.bossDead=null; repaint();
  boardGone=false;
  document.body.classList.remove("boss","boardgone");
  if (autoWas !== null && typeof S === "object" && S){
    S.autoOn = autoWas; autoWas = null;
    if (S.autoOn && typeof startAuto === "function") startAuto();
  }
  var cv=$("bossFx");
  if (cv) cv.getContext("2d").clearRect(0,0,cv.width,cv.height);
  clearKeys();
}

/* `step` IS A TEST SEAM AND IT EARNS ITS PLACE. Every animation in this file is
   driven by requestAnimationFrame, and a tab that is not compositing does not
   run rAF or advance the document timeline — which has repeatedly made working
   code look dead and broken code look fine. Exposing one call that advances the
   fight by a given dt is the difference between checking the balance and
   guessing at it. Nothing in the game calls it. */
/* ════════════════════ DROP STRAIGHT INTO A PHASE, FOR TESTING ONLY ════════════════════
   Rows are the handoff's table: odd rows are main phases, even rows are the
   breaks. Reaching row 8 by playing means seven phases and about four minutes,
   which is not a way to iterate on the last thirty seconds of a boss fight.

   A PHASE IS THREE NUMBERS - tiles owned, shield state, health - so this sets
   those three and lets the fight run normally from there. The health it hands
   you is the gate the PREVIOUS break closed at, which is exactly what you
   would have arrived with. */
function devJump(row){
  if (!F.on) return "not in the fight";
  row = Math.max(1, Math.min(2*PAD_FORCE, row|0));
  var brk  = row >> 1;                  /* rows 2,4,6,8 -> breaks 1,2,3,4 */
  var main = (row % 2) === 1;           /* rows 1,3,5,7 -> main phases */
  F.won = main ? (row-1)/2 : brk;
  F.spd = F.won ? 1 + 0.05*(F.won-1) : 1;
  F.hpW = F.hpWmax * GATE[main ? F.won : brk-1];
  for (var i=0;i<pads.length;i++){
    pads[i].won = i < F.won;
    pads[i].on  = pads[i].won && !main;
    pads[i].t   = pads[i].won ? PAD_CHARGE_MS : 0;
  }
  F.brk = main ? 0 : brk;
  F.broken = [];
  if (F.brk){ for (var q=0;q<SEGS;q++) F.broken.push(q); }
  /* main rows show the ring whole, exactly as playing there would */
  /* A MAIN PHASE REACHED BY PLAYING OPENS ON THE SHOWER - restoreShield sets
     moveIx to 1 so the tile is not free - so a jump has to do the same, or the
     rows it lands on are a different fight from the one they stand for. Row 1
     is the exception: the opening is deliberately the runes. */
  F.move = null; F.next = F.t + PULSE_GRACE;
  moveIx = (main && row > 1) ? 1 : 0;
  shots = []; sparks = []; F.ghost = undefined;
  return "row " + row + (main ? " main" : " break " + brk)
       + " - " + F.won + " tiles, hp " + Math.round(F.hpW) + "/" + F.hpWmax
       + ", spd " + F.spd.toFixed(2);
}

window.Boss = { start:bossStart, stop:bossStop, state:F, walker:W, player:P,
                jump:devJump, gates:GATE, esc:esc, tune:TUNE,
                deaths:deathCount, restart:restartFight,
                /* the cue kit and its bus, so a test can fire one and measure it
                   without having to hear it */
                sfx:SFX, sfxBus:sfxBus,
                dmg:function(){ return dmgNums; },
                god:function(v){ if(v!==undefined) GODMODE=!!v; return GODMODE; },
                /* the phase palette, exported so a test can read the colour a
                   phase actually paints with rather than guess at it */
                hue:whue, glitch:wglitch, heat:heatRGB, hx:hx,
                resetDeaths:function(){ try{ localStorage.setItem(DEATH_KEY,"0"); }catch(e){}
                                        F.deaths=0; return 0; },
                pause:function(){ devPauseToggle(performance.now()); },
                paused:function(){ return DEVPAUSE.on; },
                breakSeconds:breakSeconds, pool:walkerPool,
                brk:function(){ return F.brk; },
                won:function(){ return F.won; },
                spd:function(){ return F.spd; },
                keys:keys, isLive:function(){ return live; },
                /* ADVANCES THE WHOLE SIMULATION, not just the fight. Stepping
                   the fight alone spawns sparks and never moves them, so any
                   measurement of where the shower actually reaches came back
                   empty — which reads as "the sparks do not travel" when the
                   truth is "nothing asked them to". */
                step:function(dt, now){
                  fightStep(dt, now); playerStep(dt); sparkStep(dt); shardStep(dt);
                },
                sparks:function(){ return sparks; },
                pads:function(){ return pads; },
                rewind:function(){ return { on:rewinding, pos:rewindPos, len:tapeLen, name:BOSS_NAME }; },
                kill:function(){ startRewind(); },
                shots:function(){ return shots; },
                /* exported so a test can compare the DRAWN beam against the
                   band that damages, which is the only way to catch the two
                   drifting apart again */
                runePos:runePos,
                /* THE SAME TWO CALLS THE REAL FRAME MAKES, IN THE SAME ORDER.
                   It drew fightDraw alone, so a test that sampled the canvas
                   for the shower's corridor found an empty screen and reported
                   zero brightness everywhere — the sparks are sparkDraw's. */
                /* THE WHOLE FRAME, IN THE FRAME'S OWN ORDER. It drew sparks
                   and fightDraw only, so every canvas test of the BULLETS came
                   back with an empty screen - drawBullets was never called. */
                paint:function(){
                  var e=$("bossFx"); if(!e) return;
                  var c=e.getContext("2d");
                  c.globalCompositeOperation="lighter";
                  sparkDraw(c); fightDraw(c);
                  c.globalCompositeOperation="source-over";
                  drawPads(c, CLOCK); drawBullets(c); drawShocks(c); finDraw(c);
                  /* AND THE THREE LAYERS ON TOP OF THEM. Damage numbers, the
                     loot banner and the HUD are drawn by frame() after the
                     arena, and leaving them out here made every canvas probe of
                     the READOUT come back empty - which reads exactly like the
                     readout being broken. Same order as frame(). */
                  dmgNumDraw(c); lootDraw(c); drawPlayer(c); drawHUD(c);
                },
                /* THE HEAD/RING PASS, WHICH frame() OWNS AND NOTHING ELSE
                   CAN REACH. paintWalker draws the two art canvases and is
                   called only from frame(), so a headless probe of WHICH FACE
                   he is wearing had no way to run it - and a browser pane with
                   requestAnimationFrame throttled cannot run frame() either.
                   Exported for the same reason paint() is. */
                /* read by the preview panel, which renders them outside the
                   arena where there is room to read */
                stats:function(){ return statsLoad(); },
                statsReset:function(){ STATS = { runs:0, deaths:0, wins:0, ms:0, best:0, byCause:{} }; statsSave(); },
                vol:function(v){ return v === undefined ? MASTER : setVolume(v); },
                paintWalker:paintWalker,
                phase:function(){ return esc(); },
                shieldLeft:shieldLeft, inGap:playerInGap };
})();
