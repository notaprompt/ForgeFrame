# Cipher — Prediction Market Trading System

**Status:** Design approved
**Date:** 2026-04-21
**Author:** Alex Campos + Claude Kimi K2.6 4.6
**Repo:** Standalone (new repo, `~/repos/cipher`)
**ForgeFrame:** Optional dependency — memory via MCP if desired, not required

---

## One-Sentence Summary

An autonomous prediction market trading agent that builds its own conviction from five data signals, pitches trades to your phone, learns from every outcome, and rewires its own weights after every resolution.

---

## What This Is

A standalone Python CLI that:
1. Polls Kalshi for short-term markets (resolving within 24hrs)
2. Scores each market across five autonomous signal layers
3. Builds conviction without human thesis input
4. Pitches high-confidence trades to your phone via ntfy
5. Executes on your approval (single yes/no gate)
6. Runs mandatory retro after every resolution
7. Adjusts its own signal weights based on outcomes
8. Self-audits for cognitive biases in its own decision-making

Starting bankroll: $10. Profit skim to self-sustain. Reload on wipe with lessons preserved.

---

## Core Loop

```
POLL → FILTER (short-term, sufficient volume)
     → SCORE (5 signal layers independently)
     → BUILD CONVICTION (weighted combination)
     → PITCH TO PHONE (if confidence > 0.5 + entry rules pass)
     → YOU: APPROVE / DENY
     → EXECUTE (if approved)
     → WAIT FOR RESOLUTION
     → RETRO + LEARN
```

Poll cycle: every 60 seconds in daemon mode.

---

## Data Layer

SQLite database at `~/.cipher/cipher.db`. Six tables.

### `markets`
Cached Kalshi market data. Refreshed every 60s for active markets, pruned after resolution.

| Column | Type | Description |
|---|---|---|
| id | TEXT PK | Kalshi market ID |
| ticker | TEXT | Market ticker |
| title | TEXT | Human-readable title |
| category | TEXT | economics, politics, weather, etc. |
| close_time | DATETIME | When the market resolves |
| status | TEXT | active / resolved / closed |
| last_price | INTEGER | Last trade price (cents, 0-100) |
| volume | INTEGER | Total contracts traded |
| yes_bid | INTEGER | Best bid for YES |
| yes_ask | INTEGER | Best ask for YES |
| no_bid | INTEGER | Best bid for NO |
| no_ask | INTEGER | Best ask for NO |
| polled_at | DATETIME | Last update timestamp |

### `candles`
Time series price history. 1-minute granularity for intraday markets.

| Column | Type | Description |
|---|---|---|
| id | INTEGER PK | Auto-increment |
| market_id | TEXT FK | References markets.id |
| timestamp | DATETIME | Candle open time |
| open | INTEGER | Open price (cents) |
| high | INTEGER | High price (cents) |
| low | INTEGER | Low price (cents) |
| close | INTEGER | Close price (cents) |
| volume | INTEGER | Volume in this candle |

### `signals`
Every prediction the system makes. The audit trail.

| Column | Type | Description |
|---|---|---|
| id | INTEGER PK | Auto-increment |
| market_id | TEXT FK | References markets.id |
| timestamp | DATETIME | When signal was generated |
| data_disparity | REAL | -1 to 1, directional |
| data_disparity_conf | REAL | 0 to 1 |
| sentiment_bias | REAL | -1 to 1 |
| sentiment_bias_conf | REAL | 0 to 1 |
| rate_of_change | REAL | -1 to 1 |
| rate_of_change_conf | REAL | 0 to 1 |
| news_timing | REAL | -1 to 1 |
| news_timing_conf | REAL | 0 to 1 |
| structural | REAL | -1 to 1 |
| structural_conf | REAL | 0 to 1 |
| combined_score | REAL | Weighted blend |
| confidence | REAL | 0 to 1, agent's overall confidence |
| direction | TEXT | YES / NO |
| reasoning | TEXT | Kimi K2.6's reasoning, verbatim |
| action | TEXT | PITCH / SKIP / EXPIRED / APPROVED / DENIED |

### `trades`
Execution log.

| Column | Type | Description |
|---|---|---|
| id | INTEGER PK | Auto-increment |
| signal_id | INTEGER FK | References signals.id |
| market_id | TEXT FK | References markets.id |
| timestamp | DATETIME | Execution time |
| direction | TEXT | YES / NO |
| contracts | INTEGER | Number of contracts |
| price_paid | INTEGER | Price per contract (cents) |
| fees | REAL | Kalshi fees |
| resolved_at | DATETIME | NULL until resolved |
| outcome | TEXT | WIN / LOSS / PENDING |
| payout | REAL | NULL until resolved |
| profit_loss | REAL | NULL until resolved |
| bankroll_before | REAL | Bankroll at time of trade |
| bankroll_after | REAL | Updated after resolution |

### `retros`
Post-resolution learning. The most important table.

| Column | Type | Description |
|---|---|---|
| id | INTEGER PK | Auto-increment |
| trade_id | INTEGER FK | References trades.id |
| market_id | TEXT FK | References markets.id |
| resolved_at | DATETIME | When the market resolved |
| data_was_right | BOOLEAN | Did data disparity signal predict correctly |
| sentiment_was_right | BOOLEAN | Did sentiment bias signal predict correctly |
| roc_was_right | BOOLEAN | Did rate of change predict correctly |
| news_was_right | BOOLEAN | Did news timing predict correctly |
| structural_was_right | BOOLEAN | Did structural signal predict correctly |
| prediction_error | REAL | How far off the combined estimate was |
| lesson | TEXT | Kimi K2.6 one-sentence diagnosis |
| bias_detected | TEXT | NULL or identified bias (recency, anchoring, etc.) |
| weight_adjustment | TEXT | JSON of weight changes applied |
| retro_type | TEXT | normal / wipe / meta |
| category | TEXT | Market category for category-level learning |

### `denials`
Tracks what you said no to and what would have happened.

| Column | Type | Description |
|---|---|---|
| id | INTEGER PK | Auto-increment |
| signal_id | INTEGER FK | References signals.id |
| market_id | TEXT FK | References markets.id |
| denied_at | DATETIME | When you tapped deny |
| would_have_won | BOOLEAN | NULL until resolved, then TRUE/FALSE |
| would_have_profit | REAL | NULL until resolved |

---

## Signal Architecture

Five autonomous signal layers. No human thesis.

### Signal 1: Data Disparity (weight: 0.30)

The market price implies a probability. Public data implies a different one. The gap is the edge.

- Pull structured data relevant to the market category via public APIs
- V1 data sources (start here, expand later):
  - Economic markets: FRED API (BLS data, Treasury yields, unemployment claims), FOMC calendar
  - Weather markets: NWS API (forecasts, historical)
  - Political markets: FiveThirtyEight / RealClearPolitics polling aggregates (scrape)
  - Sports/other: skip in V1, add data sources as categories prove profitable
- Compare data-implied probability vs market price
- Score: magnitude and direction of the gap

### Signal 2: Sentiment Bias (weight: 0.20)

Where is the crowd systematically wrong?

- Detect cognitive biases in crowd positioning:
  - **Recency bias** — overweighting latest headline
  - **Anchoring** — price stuck near round numbers despite new info
  - **Herd momentum** — volume spike with no new information
  - **Availability bias** — dramatic events overpriced, boring ones underpriced
- Score: how biased the crowd appears to be and in which direction

### Signal 3: Rate of Change (weight: 0.15)

How the price is moving and whether the movement is justified.

- Price velocity (first derivative)
- Price acceleration (second derivative)
- Volume-weighted direction
- Unjustified momentum detection: fast movement with no news/data catalyst = overreaction

### Signal 4: News Timing (weight: 0.20)

Speed advantage on public information.

- RSS feeds, news APIs for keywords matching active market categories
- When relevant news drops, Kimi K2.6 scores impact on probability before the crowd reprices
- Edge window: minutes to ~1 hour
- If gap exceeds threshold before market corrects, pitch immediately

### Signal 5: Structural Mispricing (weight: 0.15)

Mechanical inefficiencies unrelated to information.

- Time decay distortion — near-expiry markets not converged to 0 or 100
- Liquidity gaps — thin order books, favorable prices
- Cross-market arbitrage — same event priced differently across categories
- Stale markets — price hasn't updated to reflect known information

---

## Decision Engine

Deterministic. Given the same inputs, always the same output.

### Confidence Scale

```python
confidence = weighted_sum([
    data_disparity      * 0.30,
    sentiment_bias      * 0.20,
    rate_of_change      * 0.15,
    news_timing         * 0.20,
    structural          * 0.15,
])
```

| Score | Meaning | Action |
|---|---|---|
| 0.0 - 0.3 | No edge detected | Skip |
| 0.3 - 0.5 | Weak signal, might be noise | Log but don't trade |
| 0.5 - 0.7 | Moderate conviction | Small position (5-10% bankroll) |
| 0.7 - 0.85 | Strong conviction, 3+ signals aligned | Standard position (10-15% bankroll) |
| 0.85 - 1.0 | Extreme conviction, all signals converge | Max position (20% bankroll, Kelly-capped) |

### Entry Rules (all must pass)

1. Confidence > 0.5
2. At least 2 of 5 signals agree on direction
3. EV exceeds inference cost + fees
4. Portfolio exposure < 60% of bankroll
5. No more than 3 open positions
6. No contradicting signal above 0.7 in opposite direction

### Position Sizing

Kelly criterion adapted for bounded prediction markets (per arXiv 2412.14144):

```
f* = (p * b - q) / b
```

Where `p` = estimated probability, `b` = payout odds, `q` = 1 - p.

Capped at 20% of bankroll per position. With $10 bankroll, max single trade is $2.

### Profit Skim

- When bankroll exceeds `skim_threshold` (default: $20, i.e., doubled)
- Withdraw `skim_rate` (default: 25%) of profits above threshold
- Skim covers inference costs, keeps system self-sustaining
- Logged in trades table

---

## Pitch System

When the agent finds a trade that passes all entry rules, it pushes a pitch to your phone via ntfy:

```
CIPHER PITCH — 0.73 confidence

Market: "Fed holds rates at June meeting"
Direction: YES
Current price: 61¢ (market says 61%)
My estimate: 78%
Edge: 17 points

Signals:
📊 Data disparity: 0.81
👥 Sentiment bias: 0.65
📈 Rate of change: 0.58
⚡ News timing: N/A
🔧 Structural: 0.44

Position: 2 contracts at 61¢ ($1.22 risk)
Max payout: $2.00 → profit $0.78
Bankroll: $10.00 → exposure 12.2%

[APPROVE]  [DENY]
```

### Pitch Rules

- One pitch at a time. No stacking.
- 30-minute expiry. No response = expired, logged, move on.
- Deny is final. No re-pitch on the same market in the same cycle.
- System learns from denials — 3 denials in same category raises threshold by 0.1 for that category.
- Missed wins (denied pitches that would have won) are tracked in `denials` table for calibration.

---

## Retro Engine

Runs automatically after every market resolution. Mandatory, no skip.

### Per-Trade Retro

1. Pull trade + signal for resolved market
2. Score each signal independently — right or wrong?
3. Compute prediction error magnitude
4. Kimi K2.6 diagnoses: "You predicted {direction} at {confidence}. Market resolved {outcome}. Your reasoning was: {reasoning}. What went wrong or right? One sentence."
5. Classify bias if detected (recency, anchoring, herd, etc.)
6. Update signal weights via exponential moving average
7. Store in `retros` table

### Meta Retro (every 20 resolved trades)

Kimi K2.6 reviews the last 20 retros:
- Which signal is overperforming / underperforming?
- Are we trading categories where we have no real edge?
- Are we overtrading? (too many positions, too frequent)
- Are we showing our own biases?
  - Concentration bias (overtrading certain categories)
  - Recency bias (overweighting recent weight adjustments)
  - Loss aversion (avoiding categories where we lost before)
  - Late entry (trading after the edge window closed)

Meta retro stored as `retro_type = 'meta'`, injected into future Kimi K2.6 reasoning prompts.

### Wipe Retro (bankroll hits $0)

Full post-mortem across ALL trades in the cycle:
- Kimi K2.6 gets complete history: every trade, signal, outcome
- Writes one paragraph: what pattern caused the wipe?
- Tagged `retro_type = 'wipe'`, injected into ALL future reasoning
- Reload $10, continue with updated weights, lessons preserved

### Edge Decay Detection

If the market price is converging toward the agent's estimate before resolution:
- The edge is shrinking
- Stop adding to the position
- Log as "edge decayed" — the crowd caught up

---

## LLM Layer

### Model

Kimi K2.6 via Moonshot API (OpenAI-compatible). $0.60/M input, $2.80/M output. Cheaper than Anthropic by 25x, outsider's perspective, strong reasoning.

### When Kimi K2.6 Is Called

1. **Signal scoring** — top N candidate markets after time series filter. One call per candidate. Prompt includes: market data, price history, signal scores, relevant retro lessons for this category.
2. **Post-trade retro** — one call per resolved trade. Diagnoses what went right/wrong.
3. **Meta retro** — one call per 20 resolved trades. Self-audit.
4. **Wipe retro** — one call per bankroll wipe. Full post-mortem.
5. **News scoring** — when breaking news matches active market categories. Speed-priority call.

### Prompt Structure (signal scoring)

```
You are a prediction market analyst evaluating a trade.

MARKET: {title}
CURRENT PRICE: {yes_price}¢ (implies {yes_price}% probability)
CLOSES: {close_time} ({hours_remaining}h remaining)
CATEGORY: {category}

PRICE HISTORY (last {N} candles):
{candle_data}

SIGNAL SCORES:
- Data disparity: {score} ({reasoning})
- Sentiment bias: {score} ({reasoning})
- Rate of change: {score} ({reasoning})
- Structural: {score} ({reasoning})

LESSONS FROM PREVIOUS {CATEGORY} TRADES:
{relevant_retros}

META LESSONS:
{meta_retros}

Estimate the true probability (0-100).
State your confidence (0.0-1.0).
Reasoning in 2-3 sentences.
Flag any cognitive biases you see in the current market pricing.
```

### Cost Budget

- Signal scoring: ~$0.10-0.20 per scan cycle (3-5 candidates)
- Retros: ~$0.02 per trade
- Meta retro: ~$0.05 per 20 trades
- Estimated daily cost at active trading: $1-3
- Must be covered by profit skim to self-sustain

---

## CLI Interface

```
cipher status        — bankroll, open positions, P&L, win rate, signal weights
cipher scan          — run one poll+score cycle, show candidates
cipher pitch         — show pending pitch (if any)
cipher approve       — approve pending pitch
cipher deny          — deny pending pitch
cipher retro         — process all resolved markets
cipher history       — trade log with outcomes
cipher lessons       — retro lessons by category
cipher weights       — current signal weights + history
cipher biases        — self-audit bias report
cipher reset         — archive current cycle, start fresh with new $10
cipher run           — continuous daemon mode (poll every 60s, auto-retro)
```

`cipher run` is the primary mode. Runs until killed, pushes pitches to phone, retros automatically.

---

## Tech Stack

| Layer | Tool | Why |
|---|---|---|
| Language | Python 3.12+ | Kalshi SDK, pandas, statsmodels, asyncio |
| Database | SQLite | Single file, portable, retro data travels with repo |
| Kalshi API | `kalshi-python` or raw REST | Market data, execution, account |
| Time series | `statsmodels` + `numpy` + `pandas` | Feature extraction, logistic regression, rolling stats |
| LLM | OpenAI SDK → Moonshot API | Kimi K2.6 for reasoning, 25x cheaper than Kimi K2.6 |
| Notifications | ntfy.sh | Pitch delivery, trade confirmations, wipe alerts |
| News | RSS + optional news API | Breaking news intake for Signal 4 |
| Scheduling | `asyncio` event loop | 60s poll cycle |
| ForgeFrame | Optional — `@forgeframe/memory` via MCP | Retro lessons in Hebbian memory, dream consolidation |

---

## File Structure

```
cipher/
├── cipher/
│   ├── __init__.py
│   ├── cli.py              — CLI entry point (click or typer)
│   ├── config.py           — bankroll, thresholds, weights, skim settings
│   ├── db.py               — SQLite schema, queries, migrations
│   ├── kalshi.py           — Kalshi API client wrapper
│   ├── signals/
│   │   ├── __init__.py
│   │   ├── data_disparity.py
│   │   ├── sentiment.py
│   │   ├── rate_of_change.py
│   │   ├── news_timing.py
│   │   └── structural.py
│   ├── engine.py           — decision engine (combine signals, entry rules)
│   ├── sizing.py           — Kelly criterion position sizing
│   ├── pitch.py            — ntfy pitch formatting + delivery
│   ├── execute.py          — Kalshi order execution
│   ├── retro.py            — retro engine (per-trade, meta, wipe)
│   ├── reasoning.py        — Kimi K2.6 prompt construction + parsing
│   ├── daemon.py           — async run loop
│   └── candles.py          — time series feature extraction
├── tests/
│   ├── test_signals.py
│   ├── test_engine.py
│   ├── test_sizing.py
│   ├── test_retro.py
│   └── test_reasoning.py
├── pyproject.toml
├── README.md
└── .env.example            — KALSHI_API_KEY, ANTHROPIC_API_KEY, NTFY_TOPIC
```

---

## What's NOT in V1

- Polymarket support (V2 — add as second exchange + cross-market arbitrage)
- Dashboard / web UI (terminal + phone notifications is enough)
- Position exit before resolution (V2 — sell contracts back on signal flip)
- Deep learning time series models (logistic regression first, upgrade when data justifies)
- Automated thesis generation (the agent reasons per-market, doesn't maintain persistent theses)
- ForgeFrame Hebbian integration (optional, not required for V1)

---

## Success Criteria

1. System can poll Kalshi, score markets, and pitch to phone within 60 seconds
2. Retro runs automatically after every resolution with lesson stored
3. Signal weights visibly shift after 20+ retros based on actual performance
4. Bias self-audit catches at least one real pattern in first 50 trades
5. System self-sustains on inference costs via profit skim after first double ($10 → $20)
6. Deterministic: same inputs always produce the same decision

---

## References

- [Application of the Kelly Criterion to Prediction Markets](https://arxiv.org/html/2412.14144v1) — position sizing math
- [Gaming Prediction Markets: Equilibrium Strategies with a Market Maker](https://dash.harvard.edu/entities/publication/73120378-9635-6bd4-e053-0100007fdf3b) — when truthful betting is/isn't Nash equilibrium
- [Online Learning in Betting Markets: Profit versus Prediction](https://arxiv.org/html/2406.04062v1) — profit vs accuracy tension
- [A Resource Theory of Gambling](https://arxiv.org/html/2510.08418v1) — adversarial information theory, Kelly-Harsanyi connection
- [Cognitive Biases Shape the Evolution of Zero-Sum Norms](https://arxiv.org/html/2511.16453v1) — which crowd biases to exploit
- [SimpleFunctions CLI](https://github.com/spfunctions/simplefunctions-cli) — MCP server pattern, market scanner reference
- [Homerun](https://github.com/braedonsaunders/homerun) — backtesting harness reference
- [Polymarket Agents](https://github.com/polymarket/agents) — execution layer reference
