# martingale.viptools.gg

A place to play BILLSKIE's martingale ladder before you play it with real money, and
to read in plain English what it usually does to the people who play it.

One file: `public/index.html`. No build step, no dependencies, no server, no
database. Open it in a browser and it works — including from the filesystem.

---

## What is in it

**Dry run.** You set the ladder up and then play it, spin by spin, on keno or on
limbo. Every draw is real: keno picks 10 tiles from 40 and scores them against
yours, limbo rolls `0.99 / u`. Nothing is approximated, and no result is
scripted. The only thing that is not real is the money.

**What usually happens.** The same strategy as statistics, written for somebody
who does not want statistics. One number and one sentence per row. **Currently
switched off** — see below.

The two are separate tabs because they answer different questions and mixing
them makes both worse.

### Things that are built but switched off

Four switches at the top of the script in `public/index.html`. They hide
finished, working code rather than deleting it, so each one comes back by
flipping it to `true` — nothing else to restore.

| switch | what it brings back |
|---|---|
| `SHOW_STATS_TAB` | the "What usually happens" tab, and the header nav that holds it |
| `SHOW_DISCLAIMER` | the footer — what the page is, where the odds come from, the helpline |
| `SHOW_RISK_BANNER` | "You are risking $X for a win worth $Y at the very best" on the setup screen |
| `SHOW_NOTES` | the prose under controls, and "It is never due" under the odds rail |

The nav hides itself when `SHOW_STATS_TAB` is off, because a tab bar with one
tab in it is telling you nothing.

The run record is no longer behind a switch — it is the statistics screen you
land on when a hunt ends.

**The disclaimer is the one to think hardest about turning back on.** Everything
else here is chrome; that is the page saying out loud that it is a simulator,
that both games return 99%, and where to get help. It costs a screenful.

---

## How a session goes

A **hunt** has a beginning and an end. A **run** is one climb of the ladder, and
a hunt is however many runs you play off one balance.

1. **Setup** — game, ladder, opening bet, balance. Seen once, at the start.
2. **Start run** — and from here the setup screen is gone.
3. Play. A run ends on a hit, on riding the whole ladder without one, or on
   running out of money. Then: **Next run**, or **End run**.
4. **End run** — available at any moment, mid-run included — closes the hunt and
   shows the statistics screen: every run, the balance line, and what the whole
   thing cost.
5. From there, **Keep going** re-opens the table with your balance intact, or
   **Start over** returns to setup for a fresh hunt.

### How many numbers, and which tier ends a round

Keno runs on **1 to 10 picks**, each with Stake's high-risk paytable for that
count. Every one of the ten returns between **98.65% and 99.01%** against the
exact distribution - 2 picks is the outlier at 98.65%, and that is arithmetic
rather than a typo in the table.

Changing the count raises a question the count does not answer: **which paying
tier ends a round.** It decides everything downstream, because the level length
is the payout, so the target sets the shape of the whole ladder.

| picks | 1 | 2 | 3 | 4 | 5 | **6** | 7 | 8 | 9 | 10 |
|---|---|---|---|---|---|---|---|---|---|---|
| target | 1/1 | 2/2 | 3/3 | 4/4 | 5/5 | **5/6** | 6/7 | 6/8 | 7/9 | 7/10 |
| pays | 3.96x | 17.1x | 81.5x | 259x | 450x | **350x** | 400x | 270x | 500x | 63x |

These are chosen, not derived. An earlier version picked the tier whose payout,
used as a level length, came closest to an even chance of landing inside it -
which is the property BILLSKIE's ladder has. On eight or more numbers that rule
returned a 3.5x consolation tier, and martingaling a 3.5x is not a strategy.

Nothing on screen names the target. The ladder itself says it: a level is the
payout long, and the round-over card tells you what hit.

### Only 3, 4 and 6 can be laddered

A martingale is only a martingale if the level covers a real share of the wait
for the tier it is priced against - that is what makes a hit recover everything
staked under it. Measured on the shipped engine, $1,400 at a $1 opening bet,
riding until broke, 2,500 runs of up to 40 rounds each:

| picks | target | level covers | rounds won | runs that lost everything |
|---|---|---|---|---|
| **3** | 3 of 3 - 81.5x | 99.0% | 93.4% | 69.4% |
| **6** | 5 of 6 - 350x | 70.9% | 77.7% | 96.5% |
| **4** | 4 of 4 - 259x | 59.5% | 74.7% | 97.8% |
| 8 | 6 of 8 - 270x | 33.4% | 52.0% | 99.9% |
| 5 | 5 of 5 - 450x | 17.2% | 29.2% | 100% |
| 7 | 6 of 7 - 400x | 13.8% | 24.4% | 100% |
| 9 | 7 of 9 - 500x | 9.8% | 18.7% | 100% |
| 10 | 7 of 10 - 63x | 3.8% | 9.5% | 100% |

Below the cliff the ladder loses most of its rounds, and since every game here
returns 99% of turnover no matter how you bet it, a strategy that loses more
rounds **and** stakes far more per round is strictly worse than flat betting.
The Wald check makes that concrete: on 5, 7, 9 and 10 picks, three thousand runs
out of three thousand ended at exactly minus the whole balance. Not usually -
every one.

So **martingale offers 3, 4 and 6**; Sandbox offers all ten. Eight is the
only close call and it is left out: a ladder that loses half its rounds is not
the thing the word describes.

The pick row has no heading and sits directly under **Simulate Keno** at exactly
that button's width, because it belongs to it. Ten of them at that width would
be 39px each, so Sandbox spills to the full row instead.

### Optimal bet

A checkbox in the ladder card, **ticked by default**, reading "Automatically
adjust bet to be optimal?". It was a button that filled in when active, which
reads as "this is a thing you can click" rather than "this is currently on". Held down, the opening bet is refitted every
time the ladder changes shape - a new pick count, a new balance, a different
multiplier - to the largest bet the balance can carry three full levels of.
Typing a bet by hand releases it, and does so before the repaint that would
otherwise write over what was just typed. The state persists with the rest of
the settings; a save written before the toggle existed carries an explicit
`false` that is not a preference, so it is turned on once and respected after
that. Three levels cost
`len1 + lenN x (step + step^2)` bets - 1,400 of them on the default ladder,
which is exactly why $1,400 at $1 is the default.

| balance | picks | 3 levels | optimal bet |
|---|---|---|---|
| $1,400 | 6 | 1,400 x bet | $1.00 |
| $1,400 | 4 | 1,039 x bet | $1.34 |
| $1,400 | 3 | 328 x bet | $4.26 |
| $2,000 | 6 | 1,400 x bet | $1.43 |
| $500 | 6 | 1,400 x bet | $0.36 |
| $10,000 | 6 | 1,400 x bet | $7.14 |

Rounding is the fiddly part. Rounding down to the cent leaves change, and at
some balances the change is enough to open a fourth level - $2,000 at six picks
funds three levels for $1,988 and then buys one spin of a fourth, which is not
"exactly three levels". So when the leftover reaches the level-4 bet the cent
rounds the other way instead, and the third level gives up a spin or two. Every
balance tested lands on exactly three levels, from $37 to $99,999.

**It is not optimal in the expected-value sense and nothing is** - every bet size
loses the same 1% of turnover. It is the biggest bet that still fits the ladder.

### Martingale, or Sandbox

The strategy choice is the first card on the setup screen, above the game and
above the money, because it is the one decision that changes what every other
control means - including which pick counts exist. It used to sit inside the
ladder card, which put the choice of whether to have a ladder inside the ladder.
It is two words in a segmented control, the same shape as the game choice - the
options do not need explaining, and a paragraph under each one made the top of
the screen look like documentation.

**The sandbox has no setup screen at all** - no balance, no bet, no pick row,
no optimal-bet toggle, and no forecast column either: every figure in "Before
you start" is a level, a cost or a chance the levels imply, so it leaves with
the ladder. Choosing the sandbox leaves three things standing: the strategy,
the game, and Start run.

Two layout rules follow it. The setup screen stretches each column's last card
so both bottoms land on the same line, and that rule keyed off `:last-child` -
which, once cards started being hidden, picked a card that was not on screen, so
the visible last card kept its margin and never took up the slack. It keys off
the last *visible* card now. And in the sandbox the rule switches off entirely:
stretching a 372px card around a 38px button to chase a bottom edge 130px away
is not a few pixels of mismatch being tidied, it is a large empty box, so both
columns take their natural height instead. It picks its numbers on the board, however many you like from one to
ten, and the count follows the board live. The stored balance and bet still
drive the first round; changing them belongs at the board, and will go there.

**Runs like yours** is the tile that says whether you have been lucky. Each
pick count has one multiplier a run is really about - the tier people are there
for, which is not always the tier that ends a round - and the tile gives the
share of runs your length that would have seen it at least once, against how
many you have actually had.

| picks | 5 | 6 | 7 | 8 | 9 | 10 |
|---|---|---|---|---|---|---|
| hits | 5 | 5 | 6 | 6 | 7 | 8 |
| high | 450x | 350x | 400x | 270x | 500x | 500x |
| medium | 390x | 180x | 400x | 67x | 100x | 100x |

It is a hit count rather than a multiplier, so medium picks up its own tier for
free. Ten numbers is the one that differs from the round-ending target: a round
ends on seven hits, but the number people are waiting for is the eight.

**The strip reports the board, not a ladder.** "Level 1 of 1" and "spin 20 of
103 on this level" describe a plan that is not there. The five tiles are Bets,
Hits, Return, Put in and Up/Down, counted run-long rather than round-long -
a sandbox round can be thousands of bets and is not the unit anyone is watching.
Return is what has come back over what has gone in, against the exact RTP of the
board you are playing, which is the number it converges to.

**Hits vs expected** is a bar a tier, showing how often each one should have
landed against how often it did. Expected is just bets x P(exactly h hits) - the
same exact figure the paytable quotes on hover. Every row is scaled to put
expected at the halfway tick, so a bar reaching the tick is par and one past it
is running hot; the rows cannot share a scale, because on ten numbers four of
them lands once in seven and all ten once in 847 million. Changing how many
numbers are picked starts the tally again, since it is only true for the board
it was gathered on - changing *which* numbers does not, the distribution being
identical.

**Editing the balance starts the tally again too.** Every tile is measured
against the money that was in play - the profit tile says "on this balance" in
as many words - so a bet count, a return and a set of hit tallies gathered on
one balance have no business sitting under the heading of another. There are
four things that clear the count now: a new run, the number of picks, the
paytable, and the balance.

Only an actual change does it. The balance commits on blur, so clicking the
figure to read it and then clicking anywhere else fires the same code path with
nothing typed, and throwing away a few thousand bets because somebody looked at
the balance would be worse than never resetting at all. Opening and closing the
editor is a true no-op - which it was not before: it used to re-base the run
baseline every time it ran, so merely looking at the balance silently zeroed
the profit tile while the balance itself did not move.

**It launches from the mode rail.** Keno and Limbo sit under Sandbox in the
rail and go straight to the board - one press to choose the game, the strategy
and to start. There is nothing to set up on the way, so the whole form is the
ladder's.

### Volatility

Keno's paytables come in two risk levels and the sandbox chooses between them.
**High** is the set BILLSKIE plays. **Medium** pays more often and pays less
when it does - on one number it even returns 0.4x for missing, which the high
table does not do at all.

| picks | high RTP | medium RTP |
|---|---|---|
| 1 | 99.00% | 98.75% |
| 2 | 98.65% | 98.65% |
| 3 | 98.99% | 98.99% |
| 4 | 98.91% | 98.78% |
| 5 | 98.89% | 98.94% |
| 6 | 99.00% | 98.84% |
| 7 | 98.96% | 98.96% |
| 8 | 98.96% | 98.92% |
| 9 | 98.96% | 98.94% |
| 10 | 99.01% | 98.97% |

All ten rows are transcribed from the source tables. Every one landing in the
same 98.65-98.99% band as the high ones is the check that they were copied
correctly, not a coincidence to lean on - a mistranscribed tier would show up as
an RTP that misses the band.

It is a dropdown above the button it governs, in the sandbox keno controls -
limbo has no paytable and the ladder is priced against high, so neither shows
it. Switching resets the tally, because a different paytable is a different game
and what was counted was counted under the old one.

The sandbox and the ladder keep their own game as well as their own money. The
launch buttons change the shared game control on the way in, so the ladder's
choice is stashed first and handed back when you return - otherwise a trip to
the limbo sandbox left the ladder playing limbo, board card hidden, a game you
never picked.

**The ladder stays on high.** Its targets and its three laddered counts were
chosen from those tiers, and medium would need its own analysis of which counts
can be laddered at all before it would mean anything.

**Nothing ends.** A round is a ladder idea: it exists so a martingale knows when
to start over. The sandbox has no ladder, so a win is paid and play carries on -
no round-over card, no Next round, no End run - and the balance simply stops
taking bets when it cannot cover one.

**It opens unlimited**, so autoplay can be left on a question that needs a
million bets. Zero is the flag for it and the balance reads "Unlimited" - a word
rather than an infinity glyph, which the mono face renders as a thin, mean
little thing at 30px and which reads as a rendering fault where a dollar figure
belongs. Typing a real figure over it makes it finite; typing zero puts it back.
It is a setting rather than an accident either way: the sandbox cannot lose its
way to exactly nothing, because it stops taking bets before it gets there.

**Limbo dials its own target**, under the number it governs, with the chance per
roll beside it - and the setup screen drops its target and chance fields
entirely, since the sandbox sets its game up at the board. A ladder's target is priced into the ladder and cannot move
mid-run; a sandbox target is just a dial.

**Running dry is not an ending.** There is no ladder to have failed and no plan
to have run out of, so when the balance will not cover the next bet the board
simply stops taking them - the button reads "Out of balance", autoplay halts,
and there is no bankrupt card and no closed run. Topping the balance up is one
click on it. A ladder run still busts properly; that is what a ladder run is.

**It opens empty**, at **$400,000** with the bet at **zero**. Nothing has been
chosen yet, so there is no paytable to quote and no bet to place: the board
starts with no tiles and no strip under it, and both fill in as you click. The
button reads "Pick a number", then "Set a bet", then Spin. A zero bet has to
survive `readForm`, which it did not - `+value || 1` turned it into a dollar and
the board opened able to bet before anything had been chosen. Clearing the board again takes the strip away
with it. **Random rolls ten** rather than matching a pick count, since the count
is whatever the board says.

**Its board is a different board.** The ladder card under it and the "where you
stand" odds panel are both readings of a ladder that is not there, so both go.
The bet leaves the stats strip - which drops to five tiles - and sits under the
balance as the balance's smaller sibling: same face, same colour, hover it and
click it and type over it. It is the same kind of thing, a number you own, so it
behaves the same way. Unset it reads "not set" in grey rather than $0.00. The balance itself stays exactly what it is on a ladder run,
the same big cream figure moving with every bet; clicking it hands you the
number to type over. It was briefly a pair of bare input boxes, and that was
wrong twice: it threw away the one reading you actually watch, and it showed the
stored balance, which only moves when a ROUND ends - thousands of bets away on a
flat run, so it sat frozen at the opening figure while the money visibly went.
What you see and edit is the live figure, and the stored balance is solved back
from it. Editing either field rebuilds the config, so the next bet and every
payout on the strip follow immediately; setting the balance also resets the
baseline the run is measured against, since a profit line counted from a number
you replaced is measuring nothing.

**The paytable strip** sits under the board in both modes - what a draw pays
and how often it comes is a fact about the board, not about the strategy on it -
above the ladder card on a martingale run and alone in the sandbox. One cell per
possible number of hits, the multiplier over the count, and on hover the payout
at your current bet, the exact chance of that outcome, and the share of the RTP
it carries. That last one is the interesting number: on six numbers the 350x is
69.6% of the whole return, so a session that has not seen one is not measuring
the game yet. The chance is
P(exactly h hits), not h or better, because the cell describes one outcome. At
ten picks that runs from 15.47% for a blank board down to 0.00000012% for all
ten, and the eleven multipliers read 0x 0x 0x 0x 3.5x 8x 13x 63x 500x 800x 1K.
The marker beside each count is amber, the same fill the board uses for a
number you chose.

It is the same machine with the climb taken out. **Sandbox**
is one bet size, one level long enough that the balance is always what ends the
round — so rounds, the history table and the balance chart keep meaning exactly
what they meant, and the only thing that changes is that losing never raises the
stake. Everything that describes a climb hides with it: the multiplier, the two
level lengths, the bail-out choice, and "Up the bet" on the round-over screen,
which is the martingale sneaking back in one round late.

"Levels you'd climb" has no answer on a flat run, so that tile answers what it
was really for — how much of a run the money buys — with the hits to expect.

Both strategies are checked against Wald at every pick count; see below.

### How the ladder ends

By default there is **no level cap**: the bet doubles every M/2 spins and you
ride until the balance cannot cover the next one. The levels are therefore
derived from the money rather than chosen — $2,000 at a $1 opening bet buys
exactly four:

| level | bet | spins | staked by the end |
|---|---|---|---|
| 1 | $1 | 350 | $350 |
| 2 | $2 | 175 | $700 |
| 3 | $4 | 175 | $1,400 |
| 4 | $8 | **75** | $2,000 |

Level 4 is truncated to the 75 spins $600 actually buys, so the totals describe
a ladder you can finish rather than one you could not. 775 spins, costing the
whole balance, hitting 79.2% of the time.

**The level list is not cut to the opening balance.** It used to be, and that
made the mode a lie on keno: the 11x drip pays money back while you play, so a
round could reach the end of a ladder priced at the starting balance while still
holding a thousand dollars of winnings. The round then stopped for having run
out of *plan*, not out of money. Levels are now built past what the balance
funds — two spare doublings, which the drip cannot outrun — and the live balance
decides when the round ends.

**The ladder is rebuilt from the live balance before every round.** Win and it
grows a little; lose and it shrinks. Deriving it once from the opening bankroll
would leave a nearly-broke hunt quoting the ladder it could afford on day one,
and the "chance before you'd give up" figure would name a bail-out point it can
no longer reach.

"A level I pick" restores the old fixed cap.

### The setup screen

The mode is a **rail down the left**, not a row of buttons in the form. Only
Martingale is ever selected in it: the other two launch and leave, so nothing
about them is ever "currently on". Marking one of them selected left the setup
screen showing a mode that has no setup - a rail, and an empty page beside it -
which is also what a reload used to do if the last session ended in a sandbox.
The setup screen is always the ladder's, and the ladder's own balance and bet
come back with it rather than the sandbox's $400,000. Two of
the three leave the screen and one does not, and while they all looked like form
controls there was no way to tell which was which - a rail cannot be confused
with a form, so the distinction cannot come back the next time something is
added to either.

Everything else is **one row per setting**: a label on the left, whatever the
setting takes on the right. It was four idioms in four cards - segmented
buttons, a checkbox, bare number grids and a second segmented control - with no
rule about which got used when. Below 620px the label goes over the control
instead of beside it.

**"Ride it until" is gone.** There was only ever one answer worth giving: the
balance. A level cap was a second way of saying "stop early", which the balance
already says on its own, and every figure on the screen had to carry a second
phrasing for it - "before you bankrupt" or "before you bail", everywhere.

### Stop on hit

A figure in the play controls, on both games: autoplay halts when a single draw
pays at least this much. Zero is off.

**Clicking a tier on the paytable strip arms it, in the sandbox only** - the
ladder's strip is a readout. The strip already says what
each outcome pays at your bet, so it is the natural place to say "and stop when
that one lands" - the alternative was reading the payout off a tooltip and
typing it into a box three rows away. The armed tier is marked amber; clicking
it again, or clicking any tier that pays nothing, turns the stop off. It stops **autoplay**, not the board - a
number you typed is a plan for the machine that is betting on its own, and a bet
you press yourself is still yours to press.

It was briefly "stop at profit", which was the wrong shape as well as the wrong
idea. A profit target is a *level*, not an *event*: once the run was above it,
every single tick re-triggered the stop, so autoplay ran exactly one bet and
halted, forever, until the field was cleared. Testing the win that just landed
cannot get stuck that way, because it resets to zero on every spin.

### A landed round rotates the seed

On the ladder, a round that hits draws a new seed, the way a real site does -
the next round is a fresh stream rather than a continuation of the one that just
paid. The cost is real and worth stating: a hunt is no longer replayable end to
end from its opening seed. Each round is replayable from the seed shown while it
is running, and the nonce beside it counts the bets placed on it.

### Go back

Top left of the play screen, beside the stats strip rather than on a line above
it, matching its height - and in the same corner of the statistics screen, so
leaving is always in the same place whichever screen you are on.

The two play columns end level without anyone measuring them: both stretch to
the taller, and the hits card is the single flexible thing in the right column,
so it absorbs the slack and scrolls the rest. `min-height:0` down the chain is
what lets it shrink below its content - without it a flex item refuses to go
under its intrinsic size and the overflow comes back. This was two passes of
`getBoundingClientRect` on every repaint, which was right until the window
changed size behind it, at which point the column overhung by a hundred pixels
and stayed that way. It returns to setup; a round
still running is quit rather than left hanging, which costs what is staked on it,
and the balance and history it earned come back with you. **Start run** always
opens a fresh hunt from the setup figures, so going back is leaving the hunt.

### A round ends the moment it cannot continue

The affordability check used to run at the top of the next spin, which meant the
bankrupt card arrived one press late - the board sat on a balance that plainly
could not cover the next bet, with a Spin button still offering to take it. The
check now runs at the end of the spin that spent the money. The sandbox is
exempt, because there running dry is not an ending.

### The run-over popup

A run ends on a hit, on riding out the affordable ladder, or on running out of
money mid-level. All three land on the same popup: what hit, what the balance
did, how far you got, and whether you carry on. The losing endings use the same
frame as the winning one on purpose — a bust screen with its own shape is one
people learn to click past.

The "how far you got" figure is the share of runs **still going, without a hit,
at the spin this one ended on**. It has a property worth knowing: a late win
reads as rarer than an early one, because fewer runs last that long. Correct in
the arithmetic, backwards from how a late win feels.

### Was I lucky?

The statistics screen puts the finish in the spread of runs like it: same
ladder, same number of rounds, twenty thousand of them, and where yours landed
among them. About 30ms.

It samples rather than replays. The wait for a hit is geometric, so the spin it
lands on is drawn directly instead of stepping through every spin, and keno's
11x drip is a Poisson draw per level.

**It is validated against Wald**, which is the identity the whole study leans on:
`E[profit] = -edge x E[total staked]`. At four million rounds the sampler agrees
to well within one standard error, and reproduces the study's own figures for
the default ladder (E[staked] $598, median +$235, 75.8% of rounds winning).

The same check is run on the **play engine itself** — the shipped `step()` and
`finish()`, lifted out of the file — across all ten pick counts and both
strategies, twenty configurations. Every one agrees with `-edge(k) x E[staked]`
within noise. The martingale rows at high pick counts are heavy-tailed enough
that a single batch can read three standard errors out; 9 picks did exactly that
and settled to 0.2 s.e. at twelve thousand runs.

Two real bugs turned up in exactly that check, and neither was visible by eye:

- every hit paid **350x**, ignoring that about one stop in 37 is the **710x** -
  worth roughly ten bets a round
- the **stopping spin was also counted as eligible for the 11x drip**, which it
  cannot be

It is an approximation in one respect and says so on screen: it holds the
opening ladder fixed, so it does not model changing the bet mid-run or the
ladder shrinking as the balance does. It answers "was I lucky", not "what
exactly were my odds".

### Limbo, checked against the real thing

Stake publishes its limbo algorithm, and it is:

```js
const floatPoint = 1e8 / (float * 1e8) * houseEdge;   // houseEdge = 0.99
const crashPoint = Math.floor(floatPoint * 100) / 100;
const result     = Math.max(crashPoint, 1);
```

`1e8 / (float * 1e8)` is `1 / float`, so that is `max(1, floor(0.99 / u * 100) / 100)`
— which is what this page rolls, character for character. It gives
`P(result >= M) = 0.99 / M` exactly, and an RTP of `M x 0.99/M = 99%` at every
target.

Measured on the shipped code, 200,000 rounds at 350x:

| hit within | measured | theory |
|---|---|---|
| 50 rolls | 13.20% | 13.21% |
| 175 rolls | 39.12% | 39.09% |
| **350 rolls** | **62.89%** | **62.89%** |
| 700 rolls | 86.24% | 86.23% |

Median roll 245, mean 354. **About 37% of rounds do not hit inside the first
350**, which is the whole reason the ladder has a second level.

### The seed

Every draw comes from a seeded **sfc32** stream. The seed is on screen and
editable: type an old one back in and that run's draws replay exactly. **New
seed** rolls a fresh one.

It used to be mulberry32, the generator the ladder study used, and that turned
out to be measurably biased for this purpose. Over 300 million draws across five
seeds it returns `u <= 0.099` about 0.1% too often — combined z of 4.3, every
seed leaning the same way. sfc32 measures clean at the same thresholds (z =
−0.3). mulberry32 stays on as the seed expander, turning one typed integer into
128 well-mixed bits, which is a job its 32 bits of state can do honestly.

The effect was far too small to notice at the table — it moves the default
limbo round win rate by about a hundredth of a point — but a page whose whole
job is checking someone else's maths should not be the thing that is wrong.

This changes nothing statistically, and the page is not claiming it does. It
exists so a surprising run can be looked at twice, which is the difference
between a simulator you can check and one you have to trust.

Changing your numbers clears the last draw. Those ten tiles were scored against
the selection you just abandoned, so leaving them lit reads as a result for a
board that never played - hits appearing and vanishing as you click around,
against numbers that were never yours.

Picking your own numbers uses `Math.random`, deliberately — your choices are not
part of the game's stream, so they do not consume it or shift the draws.

### Popups

One slot over the board, three meanings, each with its own sound:

| | colour | when |
|---|---|---|
| a payout | green | any win — the consolation tier, the target, or above it — with the amount and how rare it was |
| **Level 2** | amber | the bet has doubled once |
| **Level 3** and past it | amber to deep red, a shade grimmer each level |

The payout popup prices what just landed: `1 in 7` for four of ten, `1 in 147`
for six, `1 in 508` for BILLSKIE's 350x. It is the exact tier, the same number
the paytable strip quotes on hover, because the popup names one outcome and so
prices that outcome.

The level popup announces **Level N** with the bet change under it, and its
colour walks from amber at the first raise to a deep red by the sixth - where
the bet is 32 times the one you opened with and a friendly colour would be
lying about it. It outranks a win on the same spin, because it is the bigger news.
Nothing needs dismissing: the next spin clears whatever is showing and plays, in
one press.

### Autoplay, at a speed you set

There is no batch button. "Spin x25" was a second way to do what autoplay does,
with a worse answer to the only question that matters mid-run, which is when to
stop; the ladder still halts autoplay at a level change, because that is the
moment the strategy costs you something.

A single spin always turns its draw over at the same pace, about a second, and
the slider has nothing to do with it: the slider decides how often a bet is
placed, not how a bet is shown.

Autoplay animates too, while there is room for it. The draw has to finish inside
the gap before the next bet, so it takes three quarters of that gap - 75ms a
tile at 1/s, 25ms at 3/s, 19ms at 4/s - and past four bets a second there is
nothing left to see, so the draw lands at once. The reveal disables Spin but
never Auto: you have to be able to stop it while it is running.

The slider is labelled **Bets/s**, with the rate it is running at now on its
right. The scale is logarithmic - `75^(v/100)` bets a second, so it runs from
one a second to seventy-five - because a slider linear in bets per second spends
four fifths of its travel on speeds nobody can follow. It defaults to 63, which
is 15/s. Moving it while autoplay is running takes effect on the next tick; the
loop reads the slider every time it fires, so there is nothing to restart.

**The default is past the animation, deliberately.** 4/s is the fastest rate
that still leaves room to turn the tiles over one at a time, and it used to be
where the slider opened for exactly that reason. But the sandbox is where you
go to put thousands of bets through a board, and opening at a speed chosen to
make the reveal legible meant reaching for the slider before doing anything
else. It is a sampling rate now rather than a watching one. Drag it back below
4/s and the draw animates again.

Raising the top from 25 to 75 moved every mark on the slider, because the top
*is* the scale. 4/s sat at 43 and sits at 32 now, which is why the default in
the markup moved with it. A saved `autoRate` from before the change therefore
reads faster than it used to - 43 is 6/s now - which is visible, because the
rate is printed next to the slider.

**Autoplay keeps its rate in a background tab.** The loop is scheduled on
wall-clock time rather than on timer fires: each fire asks how much time has
actually passed and places the bets that time bought. That matters because a
hidden page's timers are throttled - to roughly one fire a second, and to one a
*minute* once it has been hidden for five - so a loop that assumed it was woken
on schedule would quietly run at a fraction of its rate with nothing on screen
to say so. Throttling now changes the shape of the work (fewer, larger batches)
and not the rate. Inside a batch the draw animation and the per-bet repaint are
suppressed and the panel is painted once at the end, since nobody is watching.

The catch-up is bounded at 90 seconds of debt, and anything past that is
dropped rather than banked: a laptop that slept for an hour should not wake up
and replay the hour.

### Reveal speed and sound

There is no Normal / Faster / Instant any more, because there is no second
speed to set. The same slider paces the reveal: a single spin always takes about a
second, and autoplay fits its reveal inside the gap before the next bet until
there is no gap left to fit it in. Limbo's climb is paced the same way.

Sound is synthesised with the Web Audio API - no files, no requests, nothing the
CSP has to allow - and each hit in a draw rings a step higher.

---

## Where the numbers come from

Exact where the maths is exact, measured where it is not.

| figure | source |
|---|---|
| keno outcome probabilities | `C(10,h)·C(30,k−h) / C(40,k)` — 40 tiles, 10 drawn, k picked, computed in the page |
| keno paytables, 1 to 10 picks | Stake's high-risk tables, each checked against the distribution: 98.65%–99.01% |
| keno stop rate | the sum over paying tiers at or above the target — at six picks `P(5) + P(6)` = 0.2024%, **1 in 494** |
| limbo hit rate | `0.99 / M` — at 350x that is **1 in 353.5** |
| limbo roll | `max(1, floor((0.99 / u) * 100) / 100)` — Stake's published formula |
| how long you wait | geometric, computed live from whichever game is selected |
| ladder cost, break-even spin | algebra, computed live from your settings |
| win rates, typical wins, lifetime figures | Monte Carlo over the same ladder — see the ladder study |

Both games return **99%** of everything staked in the long run. The page says so
in several places on purpose. A ladder moves probability between outcomes; it
does not create any.

### The one that is easy to get wrong

Break-even on a level is where staked equals the payout: `n × bet = pay × bet`,
so `n = pay`. **It does not depend on how long you made the level** — only on
whether the level is long enough to reach it. That is why the default ladder is
350 then 175: doubling the bet doubles the payout, so each new level needs only
half the spins for a hit to still cover everything staked from the first spin.

---

## Theme

The palette, the type and the square corners are lifted from `vipzone.css`, the
stylesheet `predictions.viptools.gg` ships, so the two read as one suite. That
file's rules hold here:

- **Square corners throughout.** The only radii are on things that are round
  because the shape is round.
- **Dark only, deliberately.** No light palette is defined, and every colour is
  stated outright rather than inherited.
- **A colour is a statement, not decoration**, and never means two things on one
  screen: amber is active and is keno, azure is limbo, green means it landed,
  red means it did not, cream means this one is yours.
- Limbo's azure is `#4d9de0`. It was `#3d9a9a`, a desaturated teal at hue 180
  that went slightly green beside a warm amber; azure sits at hue 205, close to
  amber's straight complement, so the two read as opposed rather than adjacent.

If `vipzone.css` changes, this file does not follow automatically. The tokens
are copied, not imported — on purpose, so this site cannot be broken by a
deploy to the other one.

---

## Local

```bash
python -m http.server 8877 --bind 127.0.0.1 --directory public
```

Or just open `public/index.html`. There is no difference; nothing here needs an
origin.

---

## Deploying

Render Blueprint, from `render.yaml`. It publishes `public/` as a static site —
no runtime, no disk, no environment variables, nothing to leak.

1. Push this repository to GitHub.
2. Render → **New** → **Blueprint** → pick it. It reads `render.yaml`.
3. On the created `martingale` service → **Settings** → **Custom Domains** → add
   `martingale.viptools.gg`, then add the CNAME it gives you wherever
   `predictions.viptools.gg`'s record already lives. TLS is issued automatically
   once the record verifies.

Redeploys are a `git push`.

---

## What it stores

One `localStorage` key, `martingale.dryrun.v2`, holding your settings, practice
balance, keno picks and run history. It goes nowhere else — there is no
analytics, no cookie, no request to anything but Google Fonts. Clearing site
data resets it.

---

## What it must never become

No real balances. No account. No link that places a bet. The moment this page
can act on somebody's money it stops being a simulator and starts being a
casino, and every honest thing it says about the strategy becomes marketing.
