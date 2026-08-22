# martingale.viptools.gg

A place to play BILLSKIE's martingale ladder before you play it with real money, and
to read in plain English what it usually does to the people who play it.

One file: `public/index.html`. No build step, no dependencies, no server, no
database. Open it in a browser and it works — including from the filesystem.

---

## What is in it

**Dry run.** You set the ladder up and then play it, spin by spin, on keno or on
limbo. Every draw is real: keno picks 10 tiles from 40 and scores them against
your six, limbo rolls `0.99 / u`. Nothing is approximated, and no result is
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

**The ladder is rebuilt from the live balance before every run.** Win and it
grows a little; lose and it shrinks. Deriving it once from the opening bankroll
would leave a nearly-broke hunt quoting the ladder it could afford on day one,
and the "chance before you'd give up" figure would name a bail-out point it can
no longer reach.

"A level I pick" restores the old fixed cap.

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

Picking your own six uses `Math.random`, deliberately — your choices are not
part of the game's stream, so they do not consume it or shift the draws.

### Popups

One slot over the board, three meanings, each with its own sound:

| | colour | when |
|---|---|---|
| a payout | green | any win — 11x, 350x, 710x — with the amount |
| **Level 2** | amber | the bet has doubled once |
| **Level 3** and past it | red | the bet has doubled again |

A level popup outranks a win on the same spin, because it is the bigger news.
Nothing needs dismissing: the next spin clears whatever is showing and plays, in
one press.

### Batches stop at the level boundary

Type any number into the batch box and the button rounds it down to whatever is
left in the current level — 25 becomes 15 if 15 remain. Autoplay halts there
too. A level change is the moment the strategy costs you something, so it is
shown to you rather than found afterwards in the log.

### Reveal speed and sound

Keno turns its draw over one tile at a time, at **Normal**, **Faster** or
**Instant**. Only a single spin animates; a batch or an autoplay would be
unwatchable at that pace, and slowing them to watch is what the single spin is
for. Sound is synthesised with the Web Audio API — no files, no requests,
nothing the CSP has to allow — and each hit in a draw rings a step higher.

---

## Where the numbers come from

Exact where the maths is exact, measured where it is not.

| figure | source |
|---|---|
| keno outcome probabilities | `C(10,k)·C(30,6−k) / C(40,6)` — 40 tiles, 10 drawn, 6 picked, computed in the page |
| keno stop rate | `P(5) + P(6)` = 0.2024% per spin, **1 in 494** |
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
  screen: amber is active and is keno, teal is limbo, green means it landed, red
  means it did not, cream means this one is yours.

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

One `localStorage` key, `martingale.dryrun.v1`, holding your settings, practice
balance, keno picks and run history. It goes nowhere else — there is no
analytics, no cookie, no request to anything but Google Fonts. Clearing site
data resets it.

---

## What it must never become

No real balances. No account. No link that places a bet. The moment this page
can act on somebody's money it stops being a simulator and starts being a
casino, and every honest thing it says about the strategy becomes marketing.
