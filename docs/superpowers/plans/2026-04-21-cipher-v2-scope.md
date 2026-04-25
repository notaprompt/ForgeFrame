# Cipher V2 — Scope Doc

**Date:** 2026-04-21 (late marathon session)
**Status:** Pre-execution scoping. Locks binding decisions before agent dispatch.
**Predecessor:** `2026-04-21-cipher-v1.md` (172KB, shipped as 10 commits → `c7fc46a`)
**Successor:** This doc. Adds 6 components including Citadel-quant time-series models.

---

## Current state (V1 as-shipped)

- **Repo:** `/Users/acamp/repos/cipher/` — 5,908 LOC, Python 3.12, hatchling/click
- **Deps already in place for V2:** numpy 2.0+, pandas 2.2+, statsmodels 0.14+
- **Entrypoints:** `cipher daemon` (async loop), `cipher test`, `cipher retro`
- **Signals (5):** `data_disparity`, `news_timing`, `rate_of_change`, `sentiment`, `structural`
- **Retro engine:** EMA weight learning live (`retro.py`), closes the loop on every resolved market
- **Execution:** Kalshi RSA auth (`kalshi.py`), Kelly sizing (`sizing.py`), Telegram bot for approve/deny
- **Reasoning:** model-agnostic OpenAI-compatible SDK (`reasoning.py`) — any frontier LLM via OpenRouter env
- **What V1 does NOT have:** multi-market (Kalshi-only), news→contract mapping is manual/coarse, no calibration report, no portfolio risk correlation, no time-series models

---

## Six V2 components

### 1. Unified news + market engine
**What:** RSS/filings/earnings feed → entity extraction → active-contract matching across markets. Replace manual "pick ticker" with "pull in everything news is talking about, match to any live contract, rank by edge."
**Why V2 not V1:** V0 (acampos.dev/projects/cipher.md) framed this as the founding idea; V1 shipped the Kalshi trading loop but left the news ingress thin. Now fuse them.
**Risk:** entity resolution accuracy — false matches are expensive at Kelly sizing. Mitigate with confidence floor + manual-approve fallback.

### 2. Multi-market sovereignty
**What:** Kalshi + Polymarket + Manifold under one execution interface. Arbitrage when the same question has divergent priced probability across venues.
**Why V2:** V1 is single-venue. Sovereignty principle = don't depend on one exchange's continued existence or terms. Also: cross-venue spreads are a clean edge when they open.
**Risk:** KYC + funding latency per venue; wallet-based (Polymarket) vs broker-based (Kalshi) reconciliation is nontrivial.

### 3. Calibration-as-metric (+ public credential loop)
**What:** For every closed position, log `(predicted_prob, actual_outcome)`. Weekly Brier score + reliability diagram + institutional-grade metrics dashboard (Sharpe, Sortino, max DD, VaR, beta, correlations). Agent reports: *"I said 60%, was right 47% of the time."* Auto-publishes weekly Substack post from the data.
**Why V2:** Connects to existing ForgeFrame memory `f2136084` ("Monetizing Uncertainty" — calibration as the actual product). The retro engine's EMA weights already produce the raw data; V2 surfaces it AND publishes it. 12 weeks of real Brier scores in public = credential-to-quant-hire lane that's higher-probability than pure bankroll growth.
**Risk:** Publishing live positions invites thin-market front-running. Mitigate with closed-positions-only weekly + 48h disclosure delay on any live mention.

### 4. Thesis-sector config from V0
**What:** Declarative `thesis.yaml`: which sectors, which risk tolerances, which news sources weigh heavier. V0 had the framing ("semiconductors, election, energy" as configured universes); V1 collapsed into one flat universe.
**Why V2:** Lets the agent have *opinions* — "I trade AI infra and energy transition, I skip crypto perps." Matches founder's actual interests instead of pretending neutrality.
**Risk:** Overfitting config to recent wins. Keep `thesis.yaml` append-only with dated entries so we can backtest regime changes.

### 5. Portfolio-level risk (Kelly across correlated markets)
**What:** Current V1 sizes each position via Kelly assuming independence. V2: covariance matrix across open positions, reduce stake when new position is correlated with existing book. Full-Kelly → fractional-Kelly floor at portfolio level.
**Why V2:** Real quant discipline. V1 can double-load on "Fed rate cut Dec" and "S&P up Dec" and "tech earnings beat Dec" — three bets, one underlying factor.
**Risk:** Covariance estimation is noisy on small N. Use shrinkage (Ledoit-Wolf) + thin priors.

### 6. Time-series models for weather/oil/energy arb (Citadel-quant style) — **NEW**
**What:** New signal layer alongside the 5 existing. Takes predictable-process markets (HDD/CDD weather contracts, oil/natgas/power settlement, seasonal commodity) and prices them from physics + statistics, not news.
**Why V2:** The 5 existing signals are all news-reactive. This is the first model-driven signal — edge comes from the market under-pricing mean-reversion or seasonal structure, not from being first to an announcement. Different correlation profile = diversifies the book.
**Components:**
  - **ARIMA/SARIMA baselines** for seasonal patterns (statsmodels, already in deps)
  - **VAR models** for cointegrated pairs (oil ↔ natgas ↔ power; HDD ↔ nat gas demand)
  - **Weather-derivative pricing:** HDD/CDD via historical-normal + forecast blend (NOAA GFS pullable free)
  - **Regime detection:** HMM or changepoint (ruptures library) to flag when mean-reversion breaks (e.g., structural oil shock)
  - **Factor decomposition:** residualize positions against market/sector/idiosyncratic — know which bet is which
  - **Backtest harness:** walk-forward validation (no lookahead), Sharpe/Sortino/max-DD reporting, commission-aware
**Why "Citadel-quant style":** the differentiator from retail is (a) factor hygiene, (b) walk-forward discipline, (c) never trusting in-sample Sharpe. V2 enforces all three.
**Risk:** Highest-complexity component. Recommend shipping as `v2.1` after core V2 (components 1-5) is stable. Walk-forward infra is reusable for every other signal afterward.

---

## Binding decisions (lock before agent dispatch)

1. **V2 ships as 2 phases.** V2 core = components 1-5. V2.1 = component 6 (time-series). Reason: time-series needs walk-forward backtesting infra that doesn't exist yet; building it right takes a week solo. Don't block 1-5 on it.

2. **Multi-market ordering: Kalshi → Polymarket → Manifold.** Kalshi is the known baseline (V1). Polymarket is the biggest cross-venue arb opportunity. Manifold is small but play-money-friendly for testing thesis flows.

3. **Calibration = shipped on day 1 of V2 core.** Cheapest component, highest signal. The retro engine already has the data; just wire a `cipher calibration` CLI command + weekly summary.

4. **`thesis.yaml` location = `~/.cipher/thesis.yaml`.** Not in repo. Per-user, like env. Ship a `thesis.example.yaml` in repo with the founder's actual current thesis as seed.

5. **Portfolio-risk uses Ledoit-Wolf shrinkage on returns covariance, 60-day window.** Not exponentially-weighted (noisier on small N). Fractional-Kelly floor = 0.25 × full-Kelly when portfolio correlation > 0.5.

6. **Time-series v2.1 starts with ONE market class.** Pick weather (HDD/CDD) first. Reason: NOAA data is free + canonical, physics are understood, and Kalshi already lists weather contracts. Oil/energy is next; power/commodity is a stretch goal.

7. **Every V2 component gates on V1 being stable for 7 consecutive days.** Stable = daemon uptime, no crash-loops, no mis-sized orders. V1 shipped today (6h ago); stability window runs through 2026-04-28. Don't start V2 until then.

8. **V2.2 funnel ordering is fixed: free education → free research → paid community → future fund.** Do not skip tiers. The coursebro failure mode is monetizing before credibility; the free layer IS the credibility. Reading list (task 2.9) ships before task 2.8 even collects a subscriber because it's the entry point for anyone who finds the first Substack post.

9. **Paid tier price floor: $50/mo, ceiling: $100/mo, for v2.2 launch.** Below $50 selects low-signal subscribers who churn; above $100 compresses TAM before track record justifies it. Match Nemeth's $100 tier once cipher has comparable receipts.

---

## Execution plan (sequencing, budgets)

### V2 core (components 1-5) — 5-7 day solo build

| Task | Component | Budget | Parallelizable? |
|------|-----------|--------|----------------|
| 2.1  | Calibration CLI + institutional metrics dashboard (Sharpe, Sortino, max DD, VaR(95/99), beta, correlation matrix, sector exposure, cumulative Brier) | 4h | no (needs retro.py) |
| 2.2  | thesis.yaml schema + loader | 2h | yes |
| 2.3  | Unified news→contract mapper | 6h | yes |
| 2.4  | Polymarket adapter (wallet auth) | 8h | no (boundary work) |
| 2.5  | Manifold adapter (API key auth) | 3h | yes after 2.4 |
| 2.6  | Portfolio-risk covariance + fractional-Kelly | 4h | yes |
| 2.7  | Cross-venue arb detector + exec | 6h | no (depends on 2.4, 2.5) |
| 2.8  | Weekly Substack auto-generator (P&L + metrics + post-mortems + repo commit link). Closed-positions-only, 48h delay on live disclosure. Publishes Sunday EOD for prior week. | 2h | yes after 2.1 + 2.6 |

Total: ~35h focused work. Across 5-7 evenings = feasible.

### V2.2 — Full funnel (free education → paid community → future capital)

Patterned on Wyandanch Library + Mispriced Assets + paid Discord — the same tier structure Nemeth runs. Each tier recruits from the one below; synchronous monetization gates on asynchronous credibility.

| Task | Component | Budget | Gate |
|------|-----------|--------|------|
| 2.9  | **Free education page** — curated reading list on prediction markets, Kelly sizing, calibration, Bayesian updating, market microstructure, walk-forward backtesting. Wyandanch-style 4-track structure (PM Fundamentals / Quant Methods / Execution / Macro). Lives at `/library` on Substack or standalone `cipher-library.dev`. | 4h | Start immediately — top-of-funnel |
| 2.10 | **Paid Discord with queryable cipher agent** — subscribers can `/ask` the live agent why it took a position, read reasoning traces, see closed-position details. Price: $50-100/mo. Built on existing ForgeFrame muscles (session hydration, memory graph, reasoning traces). | ~40h | 500+ free Substack subscribers |
| 2.11 | **SMA / fund vehicle path** — legal entity (RIA or exempt reporting adviser), auditor selection, LP-ready track record package. Not a code task. Research budget only for V2.2. | ~8h research | 12+ months live track record + auditable Brier + 1000+ Discord subs |

Reading-list handle still open: `cipher-library.dev` vs `/library` subpath on main Substack. Standalone domain is better for SEO + neutrality (non-promotional education); subpath is cheaper and traffic-compounding with main pub.

### V2.1 (time-series) — 10-14 day solo build

| Task | Component | Budget |
|------|-----------|--------|
| 2.1.1 | Walk-forward backtest harness | 8h |
| 2.1.2 | NOAA GFS puller + HDD/CDD dataset | 4h |
| 2.1.3 | SARIMA baseline on HDD/CDD | 4h |
| 2.1.4 | VAR on oil/natgas/power (yfinance + EIA) | 6h |
| 2.1.5 | HMM regime detector | 6h |
| 2.1.6 | Factor decomposition (residualize vs SPY, XLE) | 4h |
| 2.1.7 | Integrate as 6th signal in engine.py | 4h |
| 2.1.8 | Shadow-mode (log predictions, don't trade) for 7 days | wait |

Total: ~36h + 7-day shadow window.

**Soft stop:** 40h of V2 total build time across both phases. If exceeded, reassess.

---

## Register

- **Match V1's quality bar:** every function tested, no silent swallows, structured logging, error paths enumerated
- **No lookahead.** Backtest infra (V2.1) MUST fail loudly on any feature that uses post-event data
- **Calibration first.** Before every new signal ships, its calibration curve must exist. If you can't measure it, don't trade it.
- **Kill switches per layer.** Any signal can be disabled via config without code edit. Per-venue kill switch. Portfolio-level kill switch (flatten all on signal).

---

## Cross-links

- `/Users/acamp/repos/ForgeFrame/docs/superpowers/plans/2026-04-21-cipher-v1.md` — V1 implementation plan
- `/Users/acamp/repos/ForgeFrame/docs/superpowers/specs/2026-04-21-cipher-prediction-market-design.md` — V1 design rationale
- `/Users/acamp/repos/cipher/` — live codebase (as of commit `c7fc46a`)
- ForgeFrame memory `f2136084` — "Monetizing Uncertainty" (calibration-as-product framing)
- `/Users/acamp/vision/CURRENT.md` — current sprint state; cipher V2 is NOT on the Vision-v1 5-week critical path, it's parallel founder work

---

## Open threads

- **Telegram vs Cockpit for approval UI** — V1 uses Telegram bot; Cockpit could also surface pitches. Decide after V2 core lands.
- **Capital allocation between Kalshi / Polymarket / Manifold** — not a code decision; a founder decision. Suggest 70/25/5 split initially.
- **Borrow rate for shorting on Polymarket** — affects Kelly sizing when taking NO positions. Research and document before 2.4 executes.
- **LLM cost at scale** — V2 calls reasoning layer more often (cross-venue comparisons). Monitor $/decision; may need a cheaper-model triage stage before frontier call.
- **Regime-detector false-positive rate** — if HMM flags a regime break every week, it's noise. Tune before promoting to live trading.

---

## Exit gate

**V2 core:** 7 consecutive days daemon-stable + 1 cross-venue arb successfully executed + calibration report generated for week 1 of V2 positions + **first weekly Substack post published** (credential loop started).

**V2.1:** Time-series signal runs 14 days in shadow mode with Brier score ≤ 0.20 on weather contracts before it goes live. No live trading until shadow passes.

---

## Founder's call

Approved in the flow: *"all the above yes + time series model to trade predictable things like weather, oil, energy arb like a citadel quant."*

Next: execute V1 stability watch through 2026-04-28, then dispatch V2 core agents.
