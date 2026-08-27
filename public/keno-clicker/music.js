/* ═══════════════════════════════════════════════════════════════════════
   KENO IDLE — the score.

   Two files. A bed that loops under everything, and a 31-second cue for the
   gem takeover. Both are decoded to AudioBuffers ONCE, up front, and played
   through the same AudioContext the synthesised effects already use — so
   `S.muted`, the suspended-context dance and the mixing are one problem
   rather than two.

   WHY BUFFERS AND NOT <audio>. The cue has to land its impact on the frame
   the gem hits the board, and an <audio> element cannot be scheduled to a
   sample. An AudioBufferSourceNode can — `start(when, offset)` is exact.
   That is also why `connect-src 'self'` is in martingale's CSP rather than
   `media-src`: allowing <audio> would only invite the wrong approach back.

   DECODE UP FRONT, ALWAYS. `decodeAudioData` on a 31-second file takes long
   enough that firing it from inside `bigWinSequence` would miss the cue it
   was fetched for. By the time anything wants to play, the buffer is there
   or it is not, and if it is not the game simply carries on silent.
   ═══════════════════════════════════════════════════════════════════════ */

var MUSIC = {
  bed: null,          /* AudioBuffer - the loop */
  gem: null,          /* AudioBuffer - the takeover cue */
  win: null,          /* AudioBuffer - what plays after a takeover */
  bedNode: null,      /* the live source, or null */
  gemNode: null,
  winNode: null,
  bus: null,          /* everything here goes through one gain */
  started: false,     /* has the bed ever been started */
  failed: false
};

/* Where the bass lands inside the file. The cue was cut against the sequence
   so that this is the moment the gem HITS THE BOARD — `landAt + BALL_CRASH_GEM`
   — and not `landAt`, which is only when it starts falling. See MUSIC.md for
   the cue sheet. Re-cut the file if either number moves. */
var MUSIC_IMPACT_AT = 20.10;

/* Under the effects on purpose. The synthesised pings, the ball and the
   prelude are all foreground; this is the room they happen in. */
var MUSIC_BED_GAIN = 0.34;
var MUSIC_GEM_GAIN = 0.80;
/* 0 -> full over this, from the instant playback starts, wherever in the
   file that happens to be. */
var MUSIC_FADE_IN = 1.5;
var MUSIC_WIN_GAIN = 0.42;

/* ── THE DARK BED IS NOT THE OPENING OF THE GAME ──────────────────────
   It is a room tone for a room you do not have yet. On a brand new save
   there is one number on the board and nothing has happened, and scoring
   that with an ominous drone is atmosphere the game has not earned.

   Three numbers is where it starts. Same axis everything else rides —
   `extraPicks` — so the bed arrives with the first real upgrade rather
   than on a timer. Silence before that is deliberate. */
var MUSIC_BED_FROM_PICKS = 2;         /* levels bought, so 1 + 2 = 3 numbers */

/* ── THE AMBIENT BED IS OFF FOR NOW ───────────────────────────────────
   One line, deliberately. The takeover cue and the victory bed are
   unaffected — this silences only the low drone that loops under ordinary
   play. Set to false to bring it back; the file is still fetched and decoded
   either way, so flipping this needs no reload and no re-encode. */
var MUSIC_BED_OFF = true;

function musicBus(){
  var ac = audio(); if (!ac) return null;
  if (!MUSIC.bus){
    MUSIC.bus = ac.createGain();
    MUSIC.bus.gain.value = S.muted ? 0 : 1;
    MUSIC.bus.connect(ac.destination);
  }
  return MUSIC.bus;
}

/* Fetch and decode both, in parallel, once. Safe to call more than once —
   the second call sees the buffers already there and does nothing. */
function musicLoad(){
  if (MUSIC.bed || MUSIC.failed) return;
  var ac = audio(); if (!ac) return;

  function grab(url, onto){
    fetch(url).then(function(r){
      if (!r.ok) throw new Error(r.status + " " + url);
      return r.arrayBuffer();
    }).then(function(buf){
      /* the promise form is not universal on older Safari, so both are
         wired and whichever answers first wins */
      return new Promise(function(res, rej){
        var p = ac.decodeAudioData(buf, res, rej);
        if (p && p.then) p.then(res, rej);
      });
    }).then(function(audioBuf){
      MUSIC[onto] = audioBuf;
      if (onto === "bed" && MUSIC.started) musicBedStart();
      if (MUSIC.bed && MUSIC.gem && MUSIC.win) musicStamp();
    })["catch"](function(e){
      /* A missing or blocked file must not take the game down with it. The
         most likely cause by far is the CSP: without `connect-src 'self'`
         this fetch is refused before a byte moves. */
      MUSIC.failed = true;
      if (window.console) console.warn("music: " + onto + " unavailable —", e.message || e);
    });
  }
  /* THE QUERY STRING IS NOT DECORATION. Both files keep their names
     across re-cuts, so without it a browser that has heard an earlier
     version keeps serving it and every fix looks like it did nothing.
     Bump these whenever the audio is regenerated. */
  grab("audio/cold-open.m4a?v=1", "bed");
  grab("audio/gem.m4a?v=4", "gem");
  grab("audio/victory.m4a?v=1", "win");
}

/* ── the bed ───────────────────────────────────────────────────────────
   LOOPS THE WHOLE FILE, fades and all. It swells up out of nothing and
   sinks back into it roughly every two minutes, and both ends measure
   within 2 dB of silence — so the seam is inaudible and the bed simply
   breathes. For something meant to be forgettable that is a feature, not a
   defect to be trimmed out. */
function musicBedStart(){
  if (MUSIC_BED_OFF) return;
  var ac = audio(); if (!ac || !MUSIC.bed || MUSIC.bedNode) return;
  if (MUSIC.winNode) return;                    /* the victory bed has it */
  if (upLevel("extraPicks") < MUSIC_BED_FROM_PICKS) return;
  var bus = musicBus(); if (!bus) return;
  var g = ac.createGain();
  /* anchored, for the same reason as the cue's ramp: a bare `.value = 0`
     is not an automation event and leaves the ramp nothing to start from */
  g.gain.setValueAtTime(0.0001, ac.currentTime);
  g.gain.linearRampToValueAtTime(MUSIC_BED_GAIN, ac.currentTime + 2.5);
  var n = ac.createBufferSource();
  n.buffer = MUSIC.bed;
  n.loop = true;
  n.connect(g); g.connect(bus);
  n.start();
  MUSIC.bedNode = { node: n, gain: g };
  MUSIC.started = true;
}
function musicBedStop(fade){
  var ac = audio(); if (!ac || !MUSIC.bedNode) return;
  var b = MUSIC.bedNode;
  MUSIC.bedNode = null;
  var t = ac.currentTime + (fade || 0.6);
  try {
    b.gain.gain.cancelScheduledValues(ac.currentTime);
    b.gain.gain.setValueAtTime(b.gain.gain.value, ac.currentTime);
    b.gain.gain.linearRampToValueAtTime(0.0001, t);
    b.node.stop(t + 0.05);
  } catch (e) { try { b.node.stop(); } catch (e2) {} }
}

/* ── the gem cue ───────────────────────────────────────────────────────
   THE IMPACT IS BAKED INTO THE FILE at MUSIC_IMPACT_AT, so lining it up is
   a start OFFSET rather than a schedule.

   TAKES THE MOMENT THE GEM HITS THE BOARD, NOT THE MOMENT IT SETS OFF. The
   first version of this took `landAt` and was 440ms early on every single
   event — it put the bass on `bigWinFanfare()`, the flourish that plays as
   the gem begins its dive, so the loudest note in the piece landed while the
   gem was still in the air. It was reported as the drop hitting "the initial
   pulse before the diamond hits the board", which is exactly what it was.

   The moment still moves with pick count, because the pick wave is one comet
   per number you kept: 18.64s with one number, 20.60s with five or more.
   Starting the buffer `MUSIC_IMPACT_AT - impactAt` seconds in puts the bass
   on the frame every time, and what it costs is a slice of an intro that was
   ducked to near-silence anyway.

   Called with the impact time in SECONDS from the start of the sequence. */
function musicGemPlay(impactAtSec){
  var ac = audio(); if (!ac || !MUSIC.gem) return false;
  if (S.muted) return false;
  if (ac.state === "suspended") ac.resume();
  var bus = musicBus(); if (!bus) return false;

  musicGemStop(0.25, true);          /* a new takeover supersedes a ring-out */
  musicWinStop(0.8);                 /* and supersedes a victory bed */

  /* THE TRACK CAN NOW START LATE AS WELL AS EARLY. Its first half second is
     cut off, so at the ordinary pick counts the bass sits 0.5s EARLIER in
     the file than the gem hits the board — and the fix for that is to delay
     the whole track by the same half second, not to skip into it.

     delta > 0 : the file's bass is later than the crash — skip in
     delta < 0 : the file's bass is earlier — wait, then start from the top

     Waiting is what keeps the 1.5s ramp intact. Skipping into the file eats
     the ramp, which is exactly the abruptness this is meant to remove, and
     it only happens now at four numbers or fewer, where the pick wave is
     short enough that there is genuinely no room for the whole opening. */
  var delta = MUSIC_IMPACT_AT - impactAtSec;
  var offset = delta > 0 ? delta : 0;
  var wait   = delta < 0 ? -delta : 0;
  if (offset > MUSIC.gem.duration - 1) return false;

  /* ── THE FADE LIVES HERE, NOT IN THE FILE ────────────────────────────
     IT WAS BAKED INTO THE AUDIO AND IT WAS BEING SKIPPED. `offset` seeks
     into the buffer to keep the bass on the gem, and on a fresh save — one
     number picked — the gem lands 1.46s earlier than the file expects, so
     playback began 1.46s in and stepped straight over a 1.5s ramp. Full
     level from the first sample, every single time.

     Every head fade written into the file was thrown away before it was
     heard, which is why four rounds of them changed nothing whatsoever.
     Measured: `{t: 0.008, offset: 1.46}`.

     A ramp on the gain node cannot be skipped, because it is anchored to
     when playback actually starts rather than to a position in the file.
     `setValueAtTime` first — a bare `.value = 0` is not an automation event,
     so the ramp has nothing to start from and Chrome is free to jump. */
  var startAt = wait ? ac.currentTime + wait : ac.currentTime;
  var g = ac.createGain();
  g.gain.setValueAtTime(0.0001, startAt);
  g.gain.linearRampToValueAtTime(MUSIC_GEM_GAIN, startAt + MUSIC_FADE_IN);
  var n = ac.createBufferSource();
  n.buffer = MUSIC.gem;
  n.connect(g); g.connect(bus);
  /* WHEN THE CUE ENDS ON ITS OWN, THE BED COMES BACK — but ONLY if this is
     still the cue that is running.

     THE GUARD IS THE WHOLE POINT. Without it an orphaned node brings the bed
     back on top of whatever replaced it: press the shortcut twice inside the
     twelve-second ring-out and the first cue's `onended` fires halfway
     through the second one, starts the bed, and the takeover plays out under
     the wrong music. Reported as "it's not even playing the music, it just
     kept playing Clinical Void", and reproduced exactly. */
  n.onended = function(){
    if (!MUSIC.gemNode || MUSIC.gemNode.node !== n) return;   /* superseded */
    MUSIC.gemNode = null;
    musicAfterGem();
  };
  n.start(wait ? ac.currentTime + wait : 0, offset);
  MUSIC.gemNode = { node: n, gain: g, ring: false };
  return true;
}

/* ── letting it finish ─────────────────────────────────────────────────
   THE CUE IS LONGER THAN THE TAKEOVER ON PURPOSE — 43.22s against 31.01s,
   so there is a little over twelve seconds of music still to come when the
   interface returns. Cutting it off at that moment was throwing away the
   payoff: the win has just been counted up, and that is precisely the wrong
   instant to go quiet.

   So the ordinary ending marks the cue to ring out, and `bwClear` leaves it
   alone. The watchdog path does NOT mark it, so a stranded takeover still
   silences everything — a thirty-second orchestral swell over an ordinary
   board with no way to stop it is the failure this guards against. */
function musicGemLetRing(){
  if (MUSIC.gemNode) MUSIC.gemNode.ring = true;
}
/* ── what follows a takeover ───────────────────────────────────────────
   NOT THE DARK BED. You have just been paid a thousand times your bet, and
   dropping straight back into the ominous drone the moment the cue fades
   takes the win away again. A second triumphant bed carries it for a
   hundred seconds and only then hands back.

   Plays ONCE, deliberately. Looping it would make the victory the new normal
   and leave nothing for the next one to be. */
function musicAfterGem(){
  if (MUSIC.win) musicWinStart(); else musicBedStart();
}
function musicWinStart(){
  var ac = audio(); if (!ac || !MUSIC.win || MUSIC.winNode) return;
  if (S.muted) { musicBedStart(); return; }
  var bus = musicBus(); if (!bus) return;
  musicBedStop(1.0);
  var g = ac.createGain();
  g.gain.setValueAtTime(0.0001, ac.currentTime);
  g.gain.linearRampToValueAtTime(MUSIC_WIN_GAIN, ac.currentTime + 2.0);
  var n = ac.createBufferSource();
  n.buffer = MUSIC.win;
  n.connect(g); g.connect(bus);
  n.onended = function(){
    if (!MUSIC.winNode || MUSIC.winNode.node !== n) return;
    MUSIC.winNode = null;
    musicBedStart();                       /* back to the room, if it is owed */
  };
  n.start();
  MUSIC.winNode = { node: n, gain: g };
}
function musicWinStop(fade){
  var ac = audio(); if (!ac || !MUSIC.winNode) return;
  var b = MUSIC.winNode; MUSIC.winNode = null;
  var t = ac.currentTime + (fade || 0.8);
  try {
    b.gain.gain.cancelScheduledValues(ac.currentTime);
    b.gain.gain.setValueAtTime(b.gain.gain.value, ac.currentTime);
    b.gain.gain.linearRampToValueAtTime(0.0001, t);
    b.node.stop(t + 0.05);
  } catch (e) { try { b.node.stop(); } catch (e2) {} }
}

/* Is the score carrying this takeover? The synthesised gem noises defer to
   it when it is, and play as they always did when it is not. */
function musicGemActive(){
  return !!MUSIC.gemNode;
}
function musicGemRinging(){
  return !!(MUSIC.gemNode && MUSIC.gemNode.ring);
}
/* `force` supersedes a ring-out. A NEW TAKEOVER MUST ALWAYS WIN: without it
   `musicGemPlay` could not clear a cue that was still playing itself out, so
   it left the old node running and simply stopped tracking it — two cues at
   once, and an orphan whose `onended` was still wired to the bed. `bwClear`
   calls this WITHOUT force, which is what lets the ordinary ending ring. */
function musicGemStop(fade, force){
  var ac = audio(); if (!ac || !MUSIC.gemNode) return;
  if (MUSIC.gemNode.ring && !force) return;       /* it is playing itself out */
  var b = MUSIC.gemNode;
  MUSIC.gemNode = null;
  var t = ac.currentTime + (fade || 0.4);
  try {
    b.gain.gain.cancelScheduledValues(ac.currentTime);
    b.gain.gain.setValueAtTime(b.gain.gain.value, ac.currentTime);
    b.gain.gain.linearRampToValueAtTime(0.0001, t);
    b.node.stop(t + 0.05);
  } catch (e) { try { b.node.stop(); } catch (e2) {} }
}

/* ── mute ──────────────────────────────────────────────────────────────
   ONE BUS, so mute is one number. Every synthesised effect already checks
   `S.muted` and returns before making a node; the score is already playing
   by then, so it needs a gain to duck instead. */
function musicMuted(m){
  var ac = audio(); if (!ac) return;
  var bus = musicBus(); if (!bus) return;
  bus.gain.cancelScheduledValues(ac.currentTime);
  bus.gain.setValueAtTime(bus.gain.value, ac.currentTime);
  bus.gain.linearRampToValueAtTime(m ? 0.0001 : 1, ac.currentTime + 0.25);
}

/* ── the first gesture ─────────────────────────────────────────────────
   NOTHING PLAYS BEFORE ONE. Browsers will not start an AudioContext without
   a user interaction, so "music from the moment you log in" is really "from
   the first click" and there is no way around it. The listener removes
   itself, and it is on `document` rather than the board because the first
   thing a player touches might be the shop, a tile, or Play. */
/* ── proof of which build you are actually running ─────────────────────
   SAY IT OUT LOUD ON EVERY LOAD. A round of edits went by looking like it
   had done nothing at all, because the browser was serving a cached
   `index.html` and running the previous inline script — the file on disk had
   changed, the server returned the new bytes when asked, and the page never
   asked. From the chair that is indistinguishable from a broken edit.

   The cue's DURATION is the fingerprint worth printing: it changes with
   every re-cut, so it identifies the audio far better than any version
   number anyone has to remember to bump. Print the expected value next to
   it and a mismatch reads itself. */
var MUSIC_EXPECT_GEM = 42.72;   /* unchanged length, but v=4 has no baked head fade */
function musicStamp(){
  if (!window.console) return;
  var d = MUSIC.gem ? MUSIC.gem.duration.toFixed(2) : "not loaded";
  var ok = MUSIC.gem && Math.abs(MUSIC.gem.duration - MUSIC_EXPECT_GEM) < 0.02;
  console.log("%ckeno music%c  cue " + d + "s (expect " + MUSIC_EXPECT_GEM + "s) " +
              (ok ? "✓ current" : "✗ STALE — hard-reload, Ctrl+Shift+R") +
              "   bed " + (MUSIC.bed ? MUSIC.bed.duration.toFixed(2) + "s" : "not loaded") +
              "   impact at " + MUSIC_IMPACT_AT + "s in-file",
              "background:#ffb454;color:#1a1206;padding:1px 5px;border-radius:3px",
              "color:#a4a4ad");
}

function musicArm(){
  function go(){
    document.removeEventListener("pointerdown", go, true);
    document.removeEventListener("keydown", go, true);
    var ac = audio(); if (!ac) return;
    if (ac.state === "suspended") ac.resume();
    musicLoad();
    if (MUSIC.bed) musicBedStart();
    else MUSIC.started = true;            /* start it the moment it arrives */
  }
  document.addEventListener("pointerdown", go, true);
  document.addEventListener("keydown", go, true);
}
