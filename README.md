# martingale.viptools.gg

A place to play BILLSKIE's 350x ladder before you play it with real money, and
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
who does not want statistics. One number and one sentence per row.

The two are separate tabs because they answer different questions and mixing
them makes both worse.

---

## Where the numbers come from

Exact where the maths is exact, measured where it is not.

| figure | source |
|---|---|
| keno outcome probabilities | `C(10,k)·C(30,6−k) / C(40,6)` — 40 tiles, 10 drawn, 6 picked, computed in the page |
| keno stop rate | `P(5) + P(6)` = 0.2024% per spin, **1 in 494** |
| limbo hit rate | `0.99 / M` — at 350x that is **1 in 353.5** |
| how long you wait | geometric, computed live from whichever game is selected |
| ladder cost, break-even spin | algebra, computed live from your settings |
| win rates, typical wins, lifetime figures | Monte Carlo over the same ladder — see the ladder study |

Both games return **99%** of everything staked in the long run. The page says so
in several places on purpose. A ladder moves probability between outcomes; it
does not create any.

### The one that is easy to get wrong

Break-even on a rung is where staked equals the payout: `n × bet = pay × bet`,
so `n = pay`. **It does not depend on how long you made the rung** — only on
whether the rung is long enough to reach it. That is why the default ladder is
350 then 175: doubling the bet doubles the payout, so each new rung needs only
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
