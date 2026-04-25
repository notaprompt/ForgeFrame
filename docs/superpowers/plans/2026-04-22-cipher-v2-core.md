# Cipher V2 Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix V1's intelligence gap (smart radar, daemon stability) then add calibration metrics, thesis configuration, unified news→contract mapping, portfolio-level risk, and weekly Substack auto-publishing.

**Architecture:** Extends existing cipher repo. New modules: `cipher/thesis.py`, `cipher/calibration.py`, `cipher/news.py`, `cipher/portfolio_risk.py`, `cipher/substack.py`. Modifies: `cipher/daemon.py`, `cipher/telegram_bot.py`, `cipher/engine.py`.

**Tech Stack:** Python 3.12+, SQLite, feedparser (RSS), numpy, scipy (Ledoit-Wolf), httpx, existing openai SDK

---

## Task 0.1: Smart Radar

The daemon currently dumps all cached markets to telegram. Fix: add a `cipher/scanner.py` module that filters, LLM-scores, and surfaces only tradable markets.

- [ ] **Step 0.1.1: Add `scored_markets` table to db.py**

Add the table schema and CRUD functions to `cipher/db.py`.

In `SCHEMA_SQL`, append before the closing `"""`:

```python
# In cipher/db.py, append to SCHEMA_SQL string:

CREATE TABLE IF NOT EXISTS scored_markets (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    market_id   TEXT NOT NULL,
    score       REAL NOT NULL,
    thesis      TEXT NOT NULL,
    scored_at   TEXT NOT NULL,
    UNIQUE(market_id)
);

CREATE INDEX IF NOT EXISTS idx_scored_markets_score ON scored_markets(score);
```

Add these functions after the `get_market` function:

```python
# In cipher/db.py:

def upsert_scored_market(
    conn: sqlite3.Connection,
    *,
    market_id: str,
    score: float,
    thesis: str,
) -> None:
    """Insert or update a scored market candidate."""
    conn.execute(
        """
        INSERT INTO scored_markets (market_id, score, thesis, scored_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(market_id) DO UPDATE SET
            score     = excluded.score,
            thesis    = excluded.thesis,
            scored_at = excluded.scored_at
        """,
        (market_id, score, thesis, now_iso()),
    )
    conn.commit()


def get_top_scored_markets(
    conn: sqlite3.Connection,
    min_score: float = 5.0,
    limit: int = 10,
) -> list[sqlite3.Row]:
    """Return scored markets above threshold, ordered by score descending."""
    return conn.execute(
        """
        SELECT sm.*, m.title, m.yes_price, m.volume, m.close_time
        FROM scored_markets sm
        JOIN markets m ON m.id = sm.market_id
        WHERE sm.score >= ?
        ORDER BY sm.score DESC
        LIMIT ?
        """,
        (min_score, limit),
    ).fetchall()


def clear_stale_scored_markets(
    conn: sqlite3.Connection,
    max_age_hours: int = 24,
) -> int:
    """Delete scored markets older than max_age_hours. Returns count deleted."""
    cutoff = datetime.now(timezone.utc) - timedelta(hours=max_age_hours)
    cursor = conn.execute(
        "DELETE FROM scored_markets WHERE scored_at < ?",
        (cutoff.isoformat(),),
    )
    conn.commit()
    return cursor.rowcount
```

Add `timedelta` to the existing `datetime` import at the top of `db.py`:

```python
from datetime import datetime, timezone, timedelta
```

- [ ] **Step 0.1.2: Create `cipher/scanner.py`**

Create the file `cipher/scanner.py`:

```python
"""Smart market scanner — filters, LLM-scores, and ranks Kalshi candidates."""
from __future__ import annotations

import logging
import sqlite3
from datetime import datetime, timezone

from cipher.config import Config
from cipher.db import (
    get_market,
    upsert_scored_market,
)
from cipher.kalshi import KalshiClient
from cipher.reasoning import ReasoningEngine

logger = logging.getLogger("cipher.scanner")

# Tickers to skip (sports, exotic, etc.)
SKIP_PREFIXES = ("KXMVE",)

QUICK_SCORE_PROMPT = """\
Rate this prediction market's tradability on a scale of 1-10.

Market: {title}
Current YES price: {yes_price}c
Volume: {volume}
Hours remaining: {hours_remaining:.1f}
Category: {category}

Criteria:
- Informational edge potential (can research yield an opinion?)
- Liquidity (enough volume to enter/exit)
- Time horizon (enough time to react, not so much it's dead money)
- Mispricing potential (price far from likely outcome?)

Respond with ONLY valid JSON:
{{"score": <1-10>, "thesis": "<one-line thesis or reason>"}}
"""


def _should_skip(market: dict) -> bool:
    """Return True if this market should be excluded from scanning."""
    ticker = market.get("ticker", "")
    for prefix in SKIP_PREFIXES:
        if ticker.startswith(prefix):
            return True
    return False


def _parse_hours_remaining(close_time: str) -> float:
    """Parse close_time ISO string to hours remaining from now."""
    if not close_time:
        return 999.0
    try:
        ct = datetime.fromisoformat(close_time.replace("Z", "+00:00"))
        return max(0.0, (ct - datetime.now(timezone.utc)).total_seconds() / 3600)
    except (ValueError, TypeError):
        return 999.0


def scan_markets(
    conn: sqlite3.Connection,
    kalshi: KalshiClient,
    reasoning: ReasoningEngine,
    config: Config,
    min_volume: int = 100,
    max_hours: float = 48.0,
    preferred_hours: float = 48.0,
    top_n: int = 10,
) -> list[dict]:
    """Fetch markets from Kalshi, filter, LLM-score top candidates.

    Returns list of dicts with keys: market_id, title, score, thesis.
    """
    import json as _json

    try:
        raw_markets = kalshi.get_active_markets()
    except Exception as e:
        logger.error(f"Failed to fetch markets: {e}")
        return []

    # Filter: volume, skip-list, hours remaining
    candidates = []
    for m in raw_markets:
        if _should_skip(m):
            continue
        volume = m.get("volume") or 0
        if volume < min_volume:
            continue
        hours = _parse_hours_remaining(m.get("close_time", ""))
        # Prefer markets closing within preferred_hours, allow up to 168h
        if hours > 168.0:
            continue
        candidates.append((m, hours))

    # Sort: prefer closer-to-expiry with decent volume
    candidates.sort(key=lambda x: (x[1] <= preferred_hours, x[0].get("volume", 0)), reverse=True)
    candidates = candidates[:top_n]

    scored = []
    for m, hours in candidates:
        ticker = m.get("ticker", m.get("id", "?"))
        title = m.get("title", ticker)
        yes_price = m.get("last_price") or m.get("yes_ask") or 50
        volume = m.get("volume", 0)
        category = m.get("category", "unknown")

        prompt = QUICK_SCORE_PROMPT.format(
            title=title,
            yes_price=yes_price,
            volume=volume,
            hours_remaining=hours,
            category=category,
        )

        try:
            response = reasoning._client.chat.completions.create(
                model=reasoning._model,
                messages=[{"role": "user", "content": prompt}],
            )
            raw_text = response.choices[0].message.content.strip()
            # Parse JSON from response (handle markdown code blocks)
            if raw_text.startswith("```"):
                raw_text = raw_text.split("```")[1]
                if raw_text.startswith("json"):
                    raw_text = raw_text[4:]
            parsed = _json.loads(raw_text)
            llm_score = float(parsed.get("score", 0))
            thesis = str(parsed.get("thesis", ""))
        except Exception as e:
            logger.warning(f"LLM scoring failed for {ticker}: {e}")
            continue

        # Store in DB
        market_id = m.get("id", ticker)
        upsert_scored_market(
            conn,
            market_id=market_id,
            score=llm_score,
            thesis=thesis,
        )

        scored.append({
            "market_id": market_id,
            "ticker": ticker,
            "title": title,
            "score": llm_score,
            "thesis": thesis,
            "yes_price": yes_price,
            "volume": volume,
            "hours_remaining": hours,
        })
        logger.info(f"Scored {ticker}: {llm_score}/10 — {thesis[:60]}")

    # Sort by score descending
    scored.sort(key=lambda x: x["score"], reverse=True)
    return scored
```

- [ ] **Step 0.1.3: Wire scanner into telegram `radar` command**

In `cipher/telegram_bot.py`, replace the `_handle_radar` method:

```python
# In cipher/telegram_bot.py, replace _handle_radar entirely:

    def _handle_radar(self, conn: sqlite3.Connection) -> str:
        from cipher.db import get_top_scored_markets
        scored = get_top_scored_markets(conn, min_score=5.0, limit=10)
        if not scored:
            return (
                "No scored markets yet. Run *scan* to trigger LLM scoring, "
                "or wait for the next daemon cycle."
            )
        lines = [f"*Top {len(scored)} markets (LLM-scored):*"]
        for m in scored:
            title = (m["title"] or m["market_id"])[:40]
            lines.append(
                f"`{m['score']:.0f}/10  {m['yes_price'] or '?':>3}c  "
                f"vol={int(m['volume'] or 0):<5}` {title}\n"
                f"  _{m['thesis'][:70]}_"
            )
        return "\n".join(lines)
```

Add `get_top_scored_markets` to the imports at the top of `telegram_bot.py`.

- [ ] **Step 0.1.4: Add `scan` telegram command**

In `cipher/telegram_bot.py`, add the `scan` command to `handle_message` routing:

```python
# In handle_message(), add this elif before the final else:
        elif t in ("scan", "rescan", "score markets"):
            return self._handle_scan(conn)
```

Add the handler method to `CipherBot`:

```python
    def _handle_scan(self, conn: sqlite3.Connection) -> str:
        """Force an immediate market scan with LLM scoring."""
        try:
            from cipher.scanner import scan_markets
            from cipher.kalshi import KalshiClient
            from cipher.reasoning import ReasoningEngine
            kalshi = KalshiClient(self.config)
            reasoning = ReasoningEngine(self.config)
            scored = scan_markets(conn, kalshi, reasoning, self.config)
            kalshi.close()
            if not scored:
                return "Scan complete. No tradable candidates found."
            top = scored[0]
            return (
                f"Scan complete. {len(scored)} candidates scored.\n"
                f"Top: *{top['title'][:50]}*\n"
                f"Score: {top['score']}/10 — _{top['thesis'][:70]}_\n\n"
                f"Type *radar* to see all scored markets."
            )
        except Exception as e:
            return f"Scan failed: `{e}`"
```

Also update `_handle_help` to include the new commands:

```python
# Add to the help text commands list:
            "- *scan* — force LLM-scored market scan\n"
```

- [ ] **Step 0.1.5: Test scanner**

Create `tests/test_scanner.py`:

```python
"""Tests for cipher.scanner."""
import json
import sqlite3
from unittest.mock import MagicMock, patch

import pytest

from cipher.db import init_db, get_top_scored_markets, upsert_scored_market


@pytest.fixture
def db(tmp_path):
    return init_db(tmp_path / "test.db")


class TestScoredMarketsCRUD:
    def test_upsert_and_retrieve(self, db):
        upsert_scored_market(db, market_id="MKT-1", score=7.5, thesis="Strong momentum play")
        # Need a market row for the JOIN
        db.execute(
            "INSERT INTO markets (id, title, category, close_time, updated_at) "
            "VALUES ('MKT-1', 'Test Market', 'politics', '2026-05-01T00:00:00Z', '2026-04-22')"
        )
        db.commit()
        rows = get_top_scored_markets(db, min_score=5.0)
        assert len(rows) == 1
        assert rows[0]["score"] == 7.5
        assert rows[0]["thesis"] == "Strong momentum play"
        assert rows[0]["title"] == "Test Market"

    def test_min_score_filter(self, db):
        db.execute(
            "INSERT INTO markets (id, title, category, close_time, updated_at) "
            "VALUES ('MKT-1', 'Test', 'politics', '2026-05-01', '2026-04-22')"
        )
        db.commit()
        upsert_scored_market(db, market_id="MKT-1", score=3.0, thesis="Low score")
        rows = get_top_scored_markets(db, min_score=5.0)
        assert len(rows) == 0

    def test_upsert_overwrites(self, db):
        db.execute(
            "INSERT INTO markets (id, title, category, close_time, updated_at) "
            "VALUES ('MKT-1', 'Test', 'politics', '2026-05-01', '2026-04-22')"
        )
        db.commit()
        upsert_scored_market(db, market_id="MKT-1", score=5.0, thesis="Old")
        upsert_scored_market(db, market_id="MKT-1", score=8.0, thesis="New")
        rows = get_top_scored_markets(db, min_score=1.0)
        assert len(rows) == 1
        assert rows[0]["score"] == 8.0
        assert rows[0]["thesis"] == "New"


class TestScannerFilters:
    def test_skip_prefixes(self):
        from cipher.scanner import _should_skip
        assert _should_skip({"ticker": "KXMVE-SOMETHING"}) is True
        assert _should_skip({"ticker": "FED-RATE-CUT"}) is False

    def test_parse_hours_remaining(self):
        from cipher.scanner import _parse_hours_remaining
        assert _parse_hours_remaining("") == 999.0
        assert _parse_hours_remaining("not-a-date") == 999.0
        # Valid date far in the future
        hrs = _parse_hours_remaining("2099-01-01T00:00:00Z")
        assert hrs > 1000
```

- [ ] **Step 0.1.6: Commit**

```
git add cipher/scanner.py cipher/db.py cipher/telegram_bot.py tests/test_scanner.py
git commit -m "Add smart radar: LLM-scored market scanner with telegram integration"
```

---

## Task 0.2: Daemon Stability

Fix the daemon so it doesn't crash-loop. Add state persistence and structured error handling.

- [ ] **Step 0.2.1: Add daemon state file**

In `cipher/daemon.py`, add state persistence. Add these imports at the top:

```python
import json as _json
import time as _time
from pathlib import Path
```

Add these functions before `run_daemon`:

```python
_STATE_PATH = Path("~/.cipher/daemon.state").expanduser()


def _load_daemon_state() -> dict:
    """Load daemon state from disk, or return defaults."""
    try:
        if _STATE_PATH.exists():
            return _json.loads(_STATE_PATH.read_text())
    except Exception:
        pass
    return {"last_tick": None, "last_scan_count": 0, "uptime_start": None}


def _save_daemon_state(state: dict) -> None:
    """Persist daemon state to disk."""
    try:
        _STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
        _STATE_PATH.write_text(_json.dumps(state, indent=2))
    except Exception as e:
        logger.warning(f"Failed to save daemon state: {e}")
```

- [ ] **Step 0.2.2: Wrap `_tick` internals with individual error handling**

Replace the `_tick` function body with granular try/except blocks:

```python
async def _tick(
    conn: sqlite3.Connection,
    kalshi: KalshiClient | None,
    reasoning: ReasoningEngine,
    bot: CipherBot,
    config: Config,
    daemon_state: dict | None = None,
) -> None:
    """One poll cycle. Each phase has its own error boundary."""
    logger.info("Tick starting...")

    # Phase 1: Check pitch expiry
    try:
        check_pitch_expiry(conn, config=config)
    except Exception as e:
        logger.error(f"Pitch expiry check failed: {e}")

    # Skip scanning if there's a pending pitch
    try:
        pending = get_pending_pitch(conn)
        if pending:
            logger.info(f"Pending pitch exists (signal {pending['id']}), skipping scan")
            return
    except Exception as e:
        logger.error(f"Pending pitch check failed: {e}")

    # Phase 2: Check resolutions + retros
    if kalshi:
        try:
            resolved = check_resolutions(conn, kalshi, config)
            for tid in resolved:
                try:
                    run_trade_retro(conn, tid, reasoning, config)
                except Exception as e:
                    logger.error(f"Trade retro failed for #{tid}: {e}")
                # Notify on resolution
                trade = get_trade(conn, tid)
                if trade:
                    pnl = trade["pnl"] or 0
                    bot.send(
                        f"*Trade resolved*\n"
                        f"Market: `{trade['market_id']}`\n"
                        f"P&L: ${pnl:+.2f}\n"
                        f"Bankroll: ${get_current_bankroll(conn, config.starting_bankroll):.2f}"
                    )
        except Exception as e:
            logger.warning(f"Resolution check failed: {e}")

        try:
            maybe_run_meta_retro(conn, reasoning, config)
        except Exception as e:
            logger.warning(f"Meta retro failed: {e}")

        try:
            run_wipe_retro(conn, reasoning, config)
        except Exception as e:
            logger.warning(f"Wipe retro failed: {e}")

    # Phase 3: Bankroll checks
    bankroll = get_current_bankroll(conn, config.starting_bankroll)
    if bankroll < 0.01:
        bot.send("*WIPE — bankroll at zero.* Lessons preserved. Reload to continue.")
        return

    skim = should_skim(bankroll, config)
    if skim > 0:
        bot.send(f"*Skim available:* ${skim:.2f} above threshold. Bankroll: ${bankroll:.2f}")

    # Phase 4: Poll and score markets
    if not kalshi:
        return

    scan_count = 0
    try:
        markets = kalshi.get_active_markets()
        scan_count = len(markets)
        logger.info(f"Polled {scan_count} markets from Kalshi")
    except Exception as e:
        logger.warning(f"Market poll failed: {e}")
        return

    # Cache markets
    for m in markets:
        try:
            upsert_market(
                conn,
                id=m.get("id") or m.get("ticker", ""),
                title=m.get("title", ""),
                category=m.get("category", ""),
                close_time=m.get("close_time", ""),
                status="open",
                yes_price=m.get("yes_ask") or m.get("last_price"),
                no_price=m.get("no_ask"),
                volume=m.get("volume"),
            )
        except Exception:
            pass

    # Filter for volume
    candidates = [m for m in markets if (m.get("volume") or 0) >= 50]
    if not candidates:
        return

    # Score top 5
    portfolio_exposure = get_portfolio_exposure(conn)
    open_positions = len(get_open_trades(conn))

    for m in candidates[:5]:
        try:
            decision = await _score_and_evaluate(
                conn, kalshi, reasoning, m, bankroll,
                portfolio_exposure, open_positions, config,
            )
        except Exception as e:
            logger.warning(f"Scoring failed for {m.get('ticker')}: {e}")
            continue

        if decision and decision.action == "PITCH":
            _store_and_pitch(conn, m, decision, bankroll, bot, config)
            break

    # Update daemon state
    if daemon_state is not None:
        daemon_state["last_tick"] = now_iso()
        daemon_state["last_scan_count"] = scan_count
        _save_daemon_state(daemon_state)
```

Add `get_trade` to the imports from `cipher.db` at the top of `daemon.py` (it is already imported via a local import; move it to the top-level import block).

- [ ] **Step 0.2.3: Wire state into `run_daemon` loop**

In `run_daemon`, initialize and pass `daemon_state`:

```python
async def run_daemon(config: Config) -> None:
    """Initialize resources and run the daemon loop forever."""
    ensure_data_dir(config)
    conn = init_db(config.db_path)

    # Daemon state
    daemon_state = _load_daemon_state()
    daemon_state["uptime_start"] = now_iso()
    _save_daemon_state(daemon_state)

    # ... (rest of existing init: Kalshi, reasoning, bot, telegram thread) ...

    try:
        last_tick = 0.0
        while True:
            now = _time.time()
            if now - last_tick >= config.poll_interval_seconds:
                last_tick = now
                try:
                    await _tick(conn, kalshi, reasoning, bot, config, daemon_state)
                except Exception as e:
                    logger.exception(f"Tick error: {e}")
                    bot.send(f"Tick error: `{e}`")

            await asyncio.sleep(5)
    # ... (rest unchanged) ...
```

- [ ] **Step 0.2.4: Add `status` telegram command with daemon uptime**

In `cipher/telegram_bot.py`, update `_handle_status` to include daemon info:

```python
    def _handle_status(self, conn: sqlite3.Connection) -> str:
        bankroll = get_current_bankroll(conn, self.config.starting_bankroll)
        open_pos = get_open_trades(conn)
        exposure = get_portfolio_exposure(conn)
        total = count_resolved_trades(conn)

        # Safe win rate calc using bracket notation
        wins_row = conn.execute(
            "SELECT COUNT(*) FROM trades WHERE status = 'won'"
        ).fetchone()
        wins = wins_row[0] if wins_row else 0
        wr = (wins / total * 100) if total > 0 else 0

        pnl_row = conn.execute(
            "SELECT COALESCE(SUM(pnl), 0) FROM trades WHERE pnl IS NOT NULL"
        ).fetchone()
        pl = pnl_row[0] if pnl_row else 0

        # Daemon state
        daemon_info = ""
        try:
            import json as _json
            from pathlib import Path
            state_path = Path("~/.cipher/daemon.state").expanduser()
            if state_path.exists():
                state = _json.loads(state_path.read_text())
                last_tick = state.get("last_tick", "never")
                uptime_start = state.get("uptime_start", "unknown")
                scan_count = state.get("last_scan_count", 0)
                daemon_info = (
                    f"\n*Daemon:*\n"
                    f"  Up since: {uptime_start[:19] if uptime_start else 'unknown'}\n"
                    f"  Last tick: {last_tick[:19] if last_tick else 'never'}\n"
                    f"  Last scan: {scan_count} markets"
                )
        except Exception:
            daemon_info = "\n_Daemon state unavailable_"

        return (
            f"*Bankroll:* ${bankroll:.2f}\n"
            f"*Open:* {len(open_pos)} (${exposure:.2f} exposure)\n"
            f"*Resolved:* {total} trades\n"
            f"*Win rate:* {wr:.1f}%\n"
            f"*P&L:* ${pl:+.2f}"
            f"{daemon_info}"
        )
```

- [ ] **Step 0.2.5: Fix sqlite3.Row access to bracket notation**

In `cipher/telegram_bot.py`, the `_handle_status` method uses `.get()` on `sqlite3.Row` via dict-key syntax on query results. The replacement in Step 0.2.4 already fixes this by using `fetchone()[0]` for aggregate queries. Verify no other `.get()` calls on Row objects remain:

In `_handle_history`, `_handle_lessons`, `_handle_why`, and `_handle_positions`, all Row access already uses bracket notation (`row["field"]`). No changes needed beyond what Step 0.2.4 already addresses.

- [ ] **Step 0.2.6: Add error messages to telegram on command failure**

Wrap `handle_message` routing in a try/except:

```python
    def handle_message(self, text: str, conn: sqlite3.Connection) -> str:
        """Route a message to the right handler."""
        t = text.lower().strip()
        try:
            if t in ("yes", "approve", "y", "do it", "go"):
                return self._handle_approve(conn)
            elif t in ("no", "deny", "n", "pass", "nah"):
                return self._handle_deny(conn)
            elif t in ("why", "why?", "explain", "reasoning"):
                return self._handle_why(conn)
            elif t in ("status", "how are we doing", "how are we doing?"):
                return self._handle_status(conn)
            elif t in ("history", "trades"):
                return self._handle_history(conn)
            elif t in ("lessons", "what have we learned", "what have we learned?"):
                return self._handle_lessons(conn)
            elif t in ("weights", "signals"):
                return self._handle_weights()
            elif t in ("radar", "whats on radar", "what's on radar", "markets", "scanning", "what do you see"):
                return self._handle_radar(conn)
            elif t in ("positions", "open", "open positions", "what am i in"):
                return self._handle_positions(conn)
            elif t in ("scan", "rescan", "score markets"):
                return self._handle_scan(conn)
            elif t in ("help", "/help", "/start", "hi", "hi again"):
                return self._handle_help()
            else:
                return (
                    "Commands: *yes/no* (approve/deny pitch), "
                    "*why?* (explain reasoning), *status*, *history*, "
                    "*lessons*, *weights*, *radar*, *scan*, *positions*, *help*"
                )
        except Exception as e:
            logger.error(f"Command '{t}' failed: {e}")
            return f"Command failed: `{e}`"
```

- [ ] **Step 0.2.7: Test daemon stability**

Create `tests/test_daemon_stability.py`:

```python
"""Tests for daemon stability features."""
import json
from pathlib import Path

import pytest


class TestDaemonState:
    def test_save_and_load_state(self, tmp_path):
        from cipher.daemon import _save_daemon_state, _load_daemon_state, _STATE_PATH
        import cipher.daemon as daemon_mod

        # Temporarily redirect state path
        original = daemon_mod._STATE_PATH
        daemon_mod._STATE_PATH = tmp_path / "daemon.state"
        try:
            state = {"last_tick": "2026-04-22T00:00:00Z", "last_scan_count": 42, "uptime_start": "2026-04-22T00:00:00Z"}
            _save_daemon_state(state)
            loaded = _load_daemon_state()
            assert loaded["last_tick"] == "2026-04-22T00:00:00Z"
            assert loaded["last_scan_count"] == 42
        finally:
            daemon_mod._STATE_PATH = original

    def test_load_missing_state_returns_defaults(self, tmp_path):
        import cipher.daemon as daemon_mod
        original = daemon_mod._STATE_PATH
        daemon_mod._STATE_PATH = tmp_path / "nonexistent.state"
        try:
            state = daemon_mod._load_daemon_state()
            assert state["last_tick"] is None
            assert state["last_scan_count"] == 0
        finally:
            daemon_mod._STATE_PATH = original


class TestTelegramErrorHandling:
    def test_handle_message_catches_exceptions(self, db):
        from cipher.telegram_bot import CipherBot
        from cipher.config import Config
        config = Config()
        bot = CipherBot(config)
        # Calling status on a fresh db should not crash
        result = bot.handle_message("status", db)
        assert isinstance(result, str)
        assert "Bankroll" in result or "failed" in result
```

- [ ] **Step 0.2.8: Commit**

```
git add cipher/daemon.py cipher/telegram_bot.py tests/test_daemon_stability.py
git commit -m "Add daemon stability: state persistence, granular error handling, status uptime"
```

---

## Task 0.3: Telegram Reliability

Ensure all sqlite3.Row access uses bracket notation, add `_handle_scan`, and surface errors to the user.

- [ ] **Step 0.3.1: Already completed in Tasks 0.1 and 0.2**

The `_handle_scan` command was added in Step 0.1.4. Bracket notation fixes were addressed in Step 0.2.4. Error surfacing was added in Step 0.2.6. This task is folded into the prior two.

- [ ] **Step 0.3.2: Commit (if any remaining changes)**

```
git add -A && git diff --cached --quiet || git commit -m "Telegram reliability: bracket notation, error surfacing"
```

---

## Task 1.1: Calibration CLI + Metrics

Create `cipher/calibration.py` with Brier score, reliability diagram, institutional-grade portfolio metrics, and wire to CLI + Telegram.

- [ ] **Step 1.1.1: Create `cipher/calibration.py`**

```python
"""Calibration metrics and portfolio analytics for Cipher."""
from __future__ import annotations

import json
import math
import sqlite3
from dataclasses import dataclass, field
from datetime import datetime, timezone

import numpy as np

from cipher.config import Config
from cipher.db import get_all_trades, get_recent_retros


# ---------------------------------------------------------------------------
# Brier score
# ---------------------------------------------------------------------------

def compute_brier_score(
    predictions: list[float],
    outcomes: list[int],
) -> float:
    """Standard Brier score: mean of (prediction - outcome)^2.

    Lower is better. 0.0 = perfect, 0.25 = coin-flip baseline.

    Args:
        predictions: List of predicted probabilities (0-1).
        outcomes: List of binary outcomes (0 or 1).

    Returns:
        Brier score as float. Returns 1.0 if no data.
    """
    if not predictions or len(predictions) != len(outcomes):
        return 1.0
    n = len(predictions)
    return sum((p - o) ** 2 for p, o in zip(predictions, outcomes)) / n


# ---------------------------------------------------------------------------
# Reliability diagram
# ---------------------------------------------------------------------------

@dataclass
class CalibrationBin:
    """One bin in a reliability diagram."""
    bin_lower: float
    bin_upper: float
    mean_predicted: float
    mean_observed: float
    count: int


def compute_reliability_diagram(
    predictions: list[float],
    outcomes: list[int],
    n_bins: int = 10,
) -> list[CalibrationBin]:
    """Compute calibration curve data for a reliability diagram.

    Args:
        predictions: Predicted probabilities (0-1).
        outcomes: Binary outcomes (0 or 1).
        n_bins: Number of equal-width bins.

    Returns:
        List of CalibrationBin, one per bin with at least 1 sample.
    """
    if not predictions:
        return []

    bins: list[CalibrationBin] = []
    bin_width = 1.0 / n_bins

    for i in range(n_bins):
        lower = i * bin_width
        upper = (i + 1) * bin_width

        bin_preds = []
        bin_outcomes = []
        for p, o in zip(predictions, outcomes):
            if lower <= p < upper or (i == n_bins - 1 and p == upper):
                bin_preds.append(p)
                bin_outcomes.append(o)

        if bin_preds:
            bins.append(CalibrationBin(
                bin_lower=lower,
                bin_upper=upper,
                mean_predicted=sum(bin_preds) / len(bin_preds),
                mean_observed=sum(bin_outcomes) / len(bin_outcomes),
                count=len(bin_preds),
            ))

    return bins


# ---------------------------------------------------------------------------
# Portfolio metrics
# ---------------------------------------------------------------------------

@dataclass
class PortfolioMetrics:
    """Institutional-grade portfolio analytics."""
    total_trades: int = 0
    wins: int = 0
    losses: int = 0
    win_rate: float = 0.0
    total_pnl: float = 0.0
    avg_win: float = 0.0
    avg_loss: float = 0.0
    profit_factor: float = 0.0      # gross_profit / gross_loss
    sharpe_ratio: float = 0.0       # mean(returns) / std(returns), annualized
    sortino_ratio: float = 0.0      # mean(returns) / downside_std
    max_drawdown: float = 0.0       # worst peak-to-trough in dollar terms
    max_drawdown_pct: float = 0.0   # worst peak-to-trough as percentage
    var_95: float = 0.0             # Value at Risk 95%
    var_99: float = 0.0             # Value at Risk 99%
    brier_score: float = 1.0


def compute_portfolio_metrics(
    trades: list[sqlite3.Row],
) -> PortfolioMetrics:
    """Compute portfolio analytics from resolved trades.

    Args:
        trades: List of trade rows (must have 'pnl', 'status', 'entry_price',
                'contracts', 'signal_id' fields via bracket access).

    Returns:
        PortfolioMetrics dataclass.
    """
    closed = [t for t in trades if t["status"] in ("won", "lost", "closed")]
    if not closed:
        return PortfolioMetrics()

    pnls = [float(t["pnl"] or 0) for t in closed]
    wins_list = [p for p in pnls if p > 0]
    losses_list = [p for p in pnls if p < 0]

    total_trades = len(closed)
    wins = len(wins_list)
    losses = len(losses_list)
    win_rate = wins / total_trades if total_trades > 0 else 0.0
    total_pnl = sum(pnls)
    avg_win = sum(wins_list) / wins if wins > 0 else 0.0
    avg_loss = sum(losses_list) / losses if losses > 0 else 0.0

    gross_profit = sum(wins_list) if wins_list else 0.0
    gross_loss = abs(sum(losses_list)) if losses_list else 0.0
    profit_factor = gross_profit / gross_loss if gross_loss > 0 else float("inf") if gross_profit > 0 else 0.0

    # Returns as array for statistical calcs
    returns = np.array(pnls, dtype=np.float64)
    mean_ret = float(np.mean(returns))
    std_ret = float(np.std(returns, ddof=1)) if len(returns) > 1 else 0.0

    # Sharpe ratio (not annualized — trades are aperiodic)
    sharpe_ratio = mean_ret / std_ret if std_ret > 0 else 0.0

    # Sortino ratio: use downside deviation only
    downside = returns[returns < 0]
    downside_std = float(np.std(downside, ddof=1)) if len(downside) > 1 else 0.0
    sortino_ratio = mean_ret / downside_std if downside_std > 0 else 0.0

    # Max drawdown
    cumulative = np.cumsum(returns)
    peak = np.maximum.accumulate(cumulative)
    drawdowns = peak - cumulative
    max_drawdown = float(np.max(drawdowns)) if len(drawdowns) > 0 else 0.0

    # Max drawdown as percentage of peak
    peak_at_max_dd = float(peak[np.argmax(drawdowns)]) if len(drawdowns) > 0 else 0.0
    max_drawdown_pct = max_drawdown / peak_at_max_dd if peak_at_max_dd > 0 else 0.0

    # VaR (historical simulation)
    var_95 = float(np.percentile(returns, 5)) if len(returns) >= 5 else min(pnls)
    var_99 = float(np.percentile(returns, 1)) if len(returns) >= 5 else min(pnls)

    return PortfolioMetrics(
        total_trades=total_trades,
        wins=wins,
        losses=losses,
        win_rate=win_rate,
        total_pnl=total_pnl,
        avg_win=avg_win,
        avg_loss=avg_loss,
        profit_factor=profit_factor,
        sharpe_ratio=sharpe_ratio,
        sortino_ratio=sortino_ratio,
        max_drawdown=max_drawdown,
        max_drawdown_pct=max_drawdown_pct,
        var_95=var_95,
        var_99=var_99,
    )


# ---------------------------------------------------------------------------
# Full calibration report
# ---------------------------------------------------------------------------

def generate_calibration_report(
    conn: sqlite3.Connection,
    config: Config,
) -> str:
    """Generate a full calibration + metrics report.

    Pulls all resolved trades, computes Brier score, reliability diagram,
    and portfolio metrics. Returns formatted text.

    Args:
        conn: SQLite connection.
        config: Cipher config.

    Returns:
        Multi-line formatted report string.
    """
    trades = get_all_trades(conn)
    closed = [t for t in trades if t["status"] in ("won", "lost", "closed")]

    if not closed:
        return "No resolved trades yet. Need completed trades for calibration."

    # Build predictions/outcomes from signal confidence
    predictions: list[float] = []
    outcomes: list[int] = []
    for t in closed:
        # Use entry_price as the implied market probability
        confidence = float(t["entry_price"]) if t["entry_price"] else 0.5
        outcome = 1 if t["status"] == "won" else 0
        predictions.append(confidence)
        outcomes.append(outcome)

    brier = compute_brier_score(predictions, outcomes)
    bins = compute_reliability_diagram(predictions, outcomes)
    metrics = compute_portfolio_metrics(trades)
    metrics.brier_score = brier

    # Format report
    lines = [
        "=" * 50,
        "  CIPHER CALIBRATION REPORT",
        "=" * 50,
        "",
        f"Trades analyzed: {metrics.total_trades}",
        f"Win rate: {metrics.win_rate:.1%} ({metrics.wins}W / {metrics.losses}L)",
        f"Total P&L: ${metrics.total_pnl:+.2f}",
        "",
        "--- Calibration ---",
        f"Brier score: {brier:.4f}  (0=perfect, 0.25=coin flip)",
        "",
    ]

    if bins:
        lines.append("Reliability diagram:")
        lines.append(f"  {'Bin':>10}  {'Predicted':>10}  {'Observed':>10}  {'Count':>6}")
        for b in bins:
            lines.append(
                f"  {b.bin_lower:.1f}-{b.bin_upper:.1f}  "
                f"{b.mean_predicted:>10.3f}  {b.mean_observed:>10.3f}  {b.count:>6}"
            )
        lines.append("")

    lines.extend([
        "--- Portfolio Metrics ---",
        f"Sharpe ratio:   {metrics.sharpe_ratio:+.3f}",
        f"Sortino ratio:  {metrics.sortino_ratio:+.3f}",
        f"Max drawdown:   ${metrics.max_drawdown:.2f} ({metrics.max_drawdown_pct:.1%})",
        f"VaR (95%):      ${metrics.var_95:+.2f}",
        f"VaR (99%):      ${metrics.var_99:+.2f}",
        f"Profit factor:  {metrics.profit_factor:.2f}",
        f"Avg win:        ${metrics.avg_win:+.2f}",
        f"Avg loss:       ${metrics.avg_loss:+.2f}",
        "",
        "=" * 50,
    ])

    return "\n".join(lines)
```

- [ ] **Step 1.1.2: Add `cipher calibration` CLI command**

In `cipher/cli.py`, add after the `weights` command:

```python
@cli.command()
def calibration() -> None:
    """Generate calibration report with Brier score and portfolio metrics."""
    config = Config.load()
    conn = init_db(config.db_path)
    try:
        from cipher.calibration import generate_calibration_report
        report = generate_calibration_report(conn, config)
        click.echo(report)
    finally:
        conn.close()
```

- [ ] **Step 1.1.3: Add `calibration` telegram command**

In `cipher/telegram_bot.py`, add to `handle_message` routing:

```python
        elif t in ("calibration", "cal", "metrics", "brier"):
            return self._handle_calibration(conn)
```

Add the handler:

```python
    def _handle_calibration(self, conn: sqlite3.Connection) -> str:
        """Generate and return calibration report."""
        from cipher.calibration import generate_calibration_report
        report = generate_calibration_report(conn, self.config)
        # Truncate for Telegram (4096 char limit)
        if len(report) > 3900:
            report = report[:3900] + "\n...(truncated)"
        return f"```\n{report}\n```"
```

Update help text to include:

```python
            "- *calibration* — Brier score + portfolio metrics\n"
```

- [ ] **Step 1.1.4: Test calibration**

Create `tests/test_calibration.py`:

```python
"""Tests for cipher.calibration."""
import sqlite3
from pathlib import Path

import pytest

from cipher.calibration import (
    compute_brier_score,
    compute_reliability_diagram,
    compute_portfolio_metrics,
    generate_calibration_report,
)
from cipher.config import Config
from cipher.db import init_db, insert_trade, resolve_trade


@pytest.fixture
def db(tmp_path):
    return init_db(tmp_path / "test.db")


class TestBrierScore:
    def test_perfect_predictions(self):
        preds = [1.0, 0.0, 1.0, 0.0]
        outcomes = [1, 0, 1, 0]
        assert compute_brier_score(preds, outcomes) == 0.0

    def test_worst_predictions(self):
        preds = [0.0, 1.0]
        outcomes = [1, 0]
        assert compute_brier_score(preds, outcomes) == 1.0

    def test_coin_flip_baseline(self):
        preds = [0.5, 0.5, 0.5, 0.5]
        outcomes = [1, 0, 1, 0]
        assert compute_brier_score(preds, outcomes) == 0.25

    def test_empty_returns_1(self):
        assert compute_brier_score([], []) == 1.0

    def test_mismatched_lengths_returns_1(self):
        assert compute_brier_score([0.5], [1, 0]) == 1.0


class TestReliabilityDiagram:
    def test_basic_bins(self):
        preds = [0.1, 0.2, 0.3, 0.7, 0.8, 0.9]
        outcomes = [0, 0, 1, 1, 1, 1]
        bins = compute_reliability_diagram(preds, outcomes, n_bins=5)
        assert len(bins) >= 2
        for b in bins:
            assert 0.0 <= b.mean_predicted <= 1.0
            assert 0.0 <= b.mean_observed <= 1.0
            assert b.count > 0

    def test_empty_returns_empty(self):
        assert compute_reliability_diagram([], []) == []


class TestPortfolioMetrics:
    def test_with_trades(self, db):
        # Insert some markets first
        db.execute(
            "INSERT INTO markets (id, title, category, close_time, updated_at) "
            "VALUES ('M1', 'Test1', 'politics', '2026-05-01', '2026-04-22')"
        )
        db.execute(
            "INSERT INTO markets (id, title, category, close_time, updated_at) "
            "VALUES ('M2', 'Test2', 'politics', '2026-05-01', '2026-04-22')"
        )
        db.commit()

        t1 = insert_trade(db, market_id="M1", side="YES", contracts=2, entry_price=0.40)
        resolve_trade(db, t1, exit_price=1.0, pnl=1.20, status="won")

        t2 = insert_trade(db, market_id="M2", side="YES", contracts=1, entry_price=0.60)
        resolve_trade(db, t2, exit_price=0.0, pnl=-0.60, status="lost")

        from cipher.db import get_all_trades
        trades = get_all_trades(db)
        m = compute_portfolio_metrics(trades)

        assert m.total_trades == 2
        assert m.wins == 1
        assert m.losses == 1
        assert m.win_rate == 0.5
        assert m.total_pnl == pytest.approx(0.60, abs=0.01)
        assert m.avg_win == pytest.approx(1.20, abs=0.01)
        assert m.avg_loss == pytest.approx(-0.60, abs=0.01)
        assert m.profit_factor == pytest.approx(2.0, abs=0.01)
        assert m.sharpe_ratio != 0  # non-trivial
        assert m.max_drawdown >= 0

    def test_empty_trades(self):
        m = compute_portfolio_metrics([])
        assert m.total_trades == 0
        assert m.win_rate == 0.0


class TestCalibrationReport:
    def test_no_trades_message(self, db):
        config = Config()
        report = generate_calibration_report(db, config)
        assert "No resolved trades" in report

    def test_with_resolved_trades(self, db):
        db.execute(
            "INSERT INTO markets (id, title, category, close_time, updated_at) "
            "VALUES ('M1', 'Test', 'politics', '2026-05-01', '2026-04-22')"
        )
        db.commit()
        t1 = insert_trade(db, market_id="M1", side="YES", contracts=1, entry_price=0.50)
        resolve_trade(db, t1, exit_price=1.0, pnl=0.50, status="won")
        config = Config()
        report = generate_calibration_report(db, config)
        assert "CALIBRATION REPORT" in report
        assert "Brier score" in report
        assert "Sharpe" in report
```

- [ ] **Step 1.1.5: Commit**

```
git add cipher/calibration.py cipher/cli.py cipher/telegram_bot.py tests/test_calibration.py
git commit -m "Add calibration CLI and metrics: Brier score, Sharpe, Sortino, VaR, reliability diagram"
```

---

## Task 1.2: Thesis Config

Create `cipher/thesis.py` to load `~/.cipher/thesis.yaml` and filter markets through thesis matching before scoring.

- [ ] **Step 1.2.1: Add `pyyaml` to dependencies**

In `pyproject.toml`, add `pyyaml` to the dependencies list:

```toml
dependencies = [
    "click>=8.1",
    "openai>=1.40",
    "httpx>=0.27",
    "numpy>=2.0",
    "pandas>=2.2",
    "statsmodels>=0.14",
    "cryptography>=43.0",
    "pyyaml>=6.0",
]
```

- [ ] **Step 1.2.2: Create `thesis.example.yaml` in repo root**

Create file `thesis.example.yaml`:

```yaml
# Cipher thesis configuration
# Copy to ~/.cipher/thesis.yaml and customize
#
# Each thesis defines a sector/topic the agent should trade.
# Markets are matched by category + keywords in the title.
# Risk tolerance affects Kelly sizing: conservative=0.5x, moderate=1x, aggressive=1.5x

theses:
  - name: "Federal Reserve Policy"
    category: economics
    sectors:
      - fed
      - interest-rates
      - monetary-policy
    risk_tolerance: moderate
    news_keywords:
      - federal reserve
      - interest rate
      - fomc
      - powell
      - rate cut
      - rate hike
    enabled: true
    created_date: "2026-04-22"

  - name: "AI & Semiconductors"
    category: tech
    sectors:
      - artificial-intelligence
      - semiconductors
      - chips
    risk_tolerance: aggressive
    news_keywords:
      - nvidia
      - openai
      - anthropic
      - tsmc
      - chip export
      - ai regulation
    enabled: true
    created_date: "2026-04-22"

  - name: "Energy Transition"
    category: energy
    sectors:
      - oil
      - natural-gas
      - renewables
      - nuclear
    risk_tolerance: conservative
    news_keywords:
      - oil price
      - opec
      - natural gas
      - solar
      - wind energy
      - nuclear
      - energy transition
    enabled: true
    created_date: "2026-04-22"

  - name: "US Politics"
    category: politics
    sectors:
      - elections
      - legislation
      - executive
    risk_tolerance: moderate
    news_keywords:
      - congress
      - senate
      - white house
      - election
      - poll
      - legislation
      - executive order
    enabled: true
    created_date: "2026-04-22"
```

- [ ] **Step 1.2.3: Create `cipher/thesis.py`**

```python
"""Thesis configuration: declarative sector/topic filters for market selection."""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

logger = logging.getLogger("cipher.thesis")

THESIS_PATH = Path("~/.cipher/thesis.yaml").expanduser()
EXAMPLE_PATH = Path(__file__).parent.parent / "thesis.example.yaml"

# Kelly multipliers by risk tolerance
RISK_MULTIPLIERS = {
    "conservative": 0.5,
    "moderate": 1.0,
    "aggressive": 1.5,
}


@dataclass
class Thesis:
    """A single thesis entry."""
    name: str
    category: str
    sectors: list[str] = field(default_factory=list)
    risk_tolerance: str = "moderate"
    news_keywords: list[str] = field(default_factory=list)
    enabled: bool = True
    created_date: str = ""

    @property
    def kelly_multiplier(self) -> float:
        return RISK_MULTIPLIERS.get(self.risk_tolerance, 1.0)


def load_theses(path: Path | None = None) -> list[Thesis]:
    """Load thesis config from YAML file.

    Falls back to example file if user config doesn't exist.
    Returns empty list on any parse error.

    Args:
        path: Override path for testing. Defaults to ~/.cipher/thesis.yaml.

    Returns:
        List of Thesis objects.
    """
    import yaml

    target = path or THESIS_PATH
    if not target.exists():
        if EXAMPLE_PATH.exists():
            logger.info(f"No thesis config at {target}, using example from {EXAMPLE_PATH}")
            target = EXAMPLE_PATH
        else:
            logger.warning("No thesis config found. All markets pass through.")
            return []

    try:
        raw = yaml.safe_load(target.read_text())
    except Exception as e:
        logger.error(f"Failed to parse thesis config: {e}")
        return []

    if not raw or "theses" not in raw:
        return []

    theses = []
    for entry in raw["theses"]:
        try:
            theses.append(Thesis(
                name=entry["name"],
                category=entry.get("category", ""),
                sectors=entry.get("sectors", []),
                risk_tolerance=entry.get("risk_tolerance", "moderate"),
                news_keywords=entry.get("news_keywords", []),
                enabled=entry.get("enabled", True),
                created_date=entry.get("created_date", ""),
            ))
        except (KeyError, TypeError) as e:
            logger.warning(f"Skipping malformed thesis entry: {e}")

    return theses


def get_active_theses(path: Path | None = None) -> list[Thesis]:
    """Return only enabled theses.

    Args:
        path: Override path for testing.

    Returns:
        List of enabled Thesis objects.
    """
    return [t for t in load_theses(path) if t.enabled]


def match_market_to_thesis(
    market: dict,
    theses: list[Thesis],
) -> Thesis | None:
    """Match a market to the best-fitting thesis.

    Matching rules (in order of strength):
    1. Category exact match
    2. Any sector keyword appears in market title (case-insensitive)
    3. Any news_keyword appears in market title (case-insensitive)

    Returns the first matching thesis, or None if no match.

    Args:
        market: Market dict with 'title', 'category' keys.
        theses: List of active theses to match against.

    Returns:
        Matching Thesis or None.
    """
    title = (market.get("title") or "").lower()
    category = (market.get("category") or "").lower()

    for thesis in theses:
        # Category match
        if thesis.category and thesis.category.lower() == category:
            return thesis

        # Sector keyword match
        for sector in thesis.sectors:
            if sector.lower() in title:
                return thesis

        # News keyword match (broader)
        for kw in thesis.news_keywords:
            if kw.lower() in title:
                return thesis

    return None
```

- [ ] **Step 1.2.4: Wire thesis filtering into daemon `_tick`**

In `cipher/daemon.py`, after market caching and before the scoring loop, add thesis filtering:

```python
    # In _tick(), after "candidates = [m for m in markets if ...]" and before scoring loop:

    # Thesis filtering
    try:
        from cipher.thesis import get_active_theses, match_market_to_thesis
        theses = get_active_theses()
        if theses:
            thesis_filtered = []
            for m in candidates:
                match = match_market_to_thesis(m, theses)
                if match:
                    m["_thesis"] = match  # attach for downstream use
                    thesis_filtered.append(m)
            if thesis_filtered:
                candidates = thesis_filtered
                logger.info(f"Thesis filter: {len(candidates)} candidates match active theses")
            else:
                logger.info("No candidates match active theses, using full candidate list")
    except Exception as e:
        logger.warning(f"Thesis filtering failed: {e}")
```

- [ ] **Step 1.2.5: Test thesis**

Create `tests/test_thesis.py`:

```python
"""Tests for cipher.thesis."""
from pathlib import Path

import pytest

from cipher.thesis import (
    Thesis,
    get_active_theses,
    load_theses,
    match_market_to_thesis,
)


@pytest.fixture
def thesis_file(tmp_path):
    content = """
theses:
  - name: "Fed Policy"
    category: economics
    sectors:
      - fed
      - interest-rates
    risk_tolerance: moderate
    news_keywords:
      - federal reserve
      - rate cut
    enabled: true
    created_date: "2026-04-22"
  - name: "Disabled Thesis"
    category: sports
    sectors: []
    risk_tolerance: conservative
    news_keywords: []
    enabled: false
    created_date: "2026-04-22"
"""
    p = tmp_path / "thesis.yaml"
    p.write_text(content)
    return p


class TestLoadTheses:
    def test_loads_from_file(self, thesis_file):
        theses = load_theses(thesis_file)
        assert len(theses) == 2
        assert theses[0].name == "Fed Policy"
        assert theses[0].category == "economics"
        assert theses[0].risk_tolerance == "moderate"
        assert theses[0].kelly_multiplier == 1.0

    def test_missing_file_returns_empty(self, tmp_path):
        # Patch EXAMPLE_PATH to also not exist
        import cipher.thesis as mod
        orig = mod.EXAMPLE_PATH
        mod.EXAMPLE_PATH = tmp_path / "nonexistent.yaml"
        try:
            result = load_theses(tmp_path / "nope.yaml")
            assert result == []
        finally:
            mod.EXAMPLE_PATH = orig

    def test_malformed_yaml_returns_empty(self, tmp_path):
        p = tmp_path / "bad.yaml"
        p.write_text("not: valid: yaml: [[[")
        result = load_theses(p)
        assert result == []


class TestGetActiveTheses:
    def test_filters_disabled(self, thesis_file):
        active = get_active_theses(thesis_file)
        assert len(active) == 1
        assert active[0].name == "Fed Policy"


class TestMatchMarket:
    def test_category_match(self, thesis_file):
        theses = get_active_theses(thesis_file)
        market = {"title": "Something", "category": "economics"}
        match = match_market_to_thesis(market, theses)
        assert match is not None
        assert match.name == "Fed Policy"

    def test_sector_keyword_match(self, thesis_file):
        theses = get_active_theses(thesis_file)
        market = {"title": "Fed rate decision", "category": "other"}
        match = match_market_to_thesis(market, theses)
        assert match is not None

    def test_news_keyword_match(self, thesis_file):
        theses = get_active_theses(thesis_file)
        market = {"title": "Will there be a rate cut in June?", "category": "other"}
        match = match_market_to_thesis(market, theses)
        assert match is not None

    def test_no_match(self, thesis_file):
        theses = get_active_theses(thesis_file)
        market = {"title": "Who wins the Super Bowl?", "category": "sports"}
        match = match_market_to_thesis(market, theses)
        assert match is None

    def test_empty_theses(self):
        market = {"title": "Anything", "category": "any"}
        match = match_market_to_thesis(market, [])
        assert match is None

    def test_kelly_multipliers(self):
        conservative = Thesis(name="C", category="x", risk_tolerance="conservative")
        aggressive = Thesis(name="A", category="x", risk_tolerance="aggressive")
        assert conservative.kelly_multiplier == 0.5
        assert aggressive.kelly_multiplier == 1.5
```

- [ ] **Step 1.2.6: Commit**

```
git add cipher/thesis.py thesis.example.yaml pyproject.toml cipher/daemon.py tests/test_thesis.py
git commit -m "Add thesis config: YAML-driven sector filtering with Kelly risk multipliers"
```

---

## Task 1.3: News-to-Contract Mapper

Create `cipher/news.py` to replace the `news_timing` stub signal with real RSS-driven news matching.

- [ ] **Step 1.3.1: Add `feedparser` to dependencies**

In `pyproject.toml`, add to dependencies:

```toml
    "feedparser>=6.0",
```

- [ ] **Step 1.3.2: Create `cipher/news.py`**

```python
"""Unified news feed → contract mapper. Replaces the news_timing stub."""
from __future__ import annotations

import json
import logging
import re
import sqlite3
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

import feedparser

from cipher.config import Config
from cipher.reasoning import ReasoningEngine

logger = logging.getLogger("cipher.news")

# Default RSS feeds (free, no API key required)
DEFAULT_FEEDS = [
    "https://feeds.reuters.com/reuters/topNews",
    "https://feeds.reuters.com/reuters/businessNews",
    "https://rss.app/feeds/v1.1/cnbc-top-news.xml",
    "https://feeds.bbci.co.uk/news/business/rss.xml",
]

NEWS_IMPACT_TOOL: dict[str, Any] = {
    "name": "submit_news_impact",
    "description": "Rate how a news article impacts a prediction market contract.",
    "parameters": {
        "type": "object",
        "properties": {
            "impact_score": {
                "type": "number",
                "description": "Impact score from -1 (strongly bearish) to +1 (strongly bullish) on the YES outcome.",
            },
            "confidence": {
                "type": "number",
                "description": "Confidence in the impact assessment (0-1).",
            },
            "reasoning": {
                "type": "string",
                "description": "Brief explanation of the causal link.",
            },
        },
        "required": ["impact_score", "confidence", "reasoning"],
    },
}


@dataclass
class NewsArticle:
    """A single news article from an RSS feed."""
    title: str
    summary: str
    link: str
    published: str
    source: str
    entities: list[str] = field(default_factory=list)


@dataclass
class NewsMatch:
    """A matched news article + market pair."""
    article: NewsArticle
    market_id: str
    market_title: str
    match_score: float      # 0-1, how strong the keyword overlap is
    impact_score: float     # -1 to +1, LLM-rated directional impact
    impact_confidence: float
    impact_reasoning: str = ""


def fetch_news_feeds(
    feed_urls: list[str] | None = None,
    max_articles_per_feed: int = 10,
) -> list[NewsArticle]:
    """Fetch articles from RSS feeds.

    Args:
        feed_urls: List of RSS feed URLs. Defaults to DEFAULT_FEEDS.
        max_articles_per_feed: Max articles to take from each feed.

    Returns:
        List of NewsArticle objects, deduplicated by title.
    """
    urls = feed_urls or DEFAULT_FEEDS
    seen_titles: set[str] = set()
    articles: list[NewsArticle] = []

    for url in urls:
        try:
            feed = feedparser.parse(url)
            source = feed.feed.get("title", url)[:30]
            for entry in feed.entries[:max_articles_per_feed]:
                title = entry.get("title", "").strip()
                if not title or title in seen_titles:
                    continue
                seen_titles.add(title)
                articles.append(NewsArticle(
                    title=title,
                    summary=entry.get("summary", "")[:500],
                    link=entry.get("link", ""),
                    published=entry.get("published", ""),
                    source=source,
                ))
        except Exception as e:
            logger.warning(f"Failed to fetch feed {url}: {e}")

    return articles


def extract_entities(article: NewsArticle) -> list[str]:
    """Extract key entities/keywords from an article.

    Simple approach: split title into significant words (3+ chars),
    plus any capitalized multi-word phrases from summary.

    Args:
        article: NewsArticle to extract from.

    Returns:
        List of entity strings (lowercased).
    """
    # Title words (3+ chars, not common stop words)
    stop_words = {
        "the", "and", "for", "are", "but", "not", "you", "all",
        "can", "has", "her", "was", "one", "our", "out", "his",
        "how", "its", "may", "new", "now", "say", "she", "too",
        "use", "who", "will", "with", "from", "that", "this",
        "what", "when", "than", "more", "some", "could", "would",
        "about", "after", "their", "which", "these", "other",
    }
    words = re.findall(r'\b[a-zA-Z]{3,}\b', article.title)
    entities = [w.lower() for w in words if w.lower() not in stop_words]

    # Capitalized phrases from summary (potential proper nouns)
    proper_nouns = re.findall(r'\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b', article.summary)
    entities.extend([pn.lower() for pn in proper_nouns])

    # Deduplicate preserving order
    seen: set[str] = set()
    unique: list[str] = []
    for e in entities:
        if e not in seen:
            seen.add(e)
            unique.append(e)

    article.entities = unique
    return unique


def match_to_contracts(
    articles: list[NewsArticle],
    active_markets: list[dict],
    min_overlap: int = 1,
) -> list[tuple[NewsArticle, dict, float]]:
    """Fuzzy-match news articles to active market contracts.

    Uses keyword overlap between article entities and market title words.

    Args:
        articles: List of NewsArticle with entities already extracted.
        active_markets: List of market dicts with 'title', 'id' keys.
        min_overlap: Minimum number of keyword matches to count as a match.

    Returns:
        List of (article, market, match_score) tuples, sorted by score desc.
    """
    matches: list[tuple[NewsArticle, dict, float]] = []

    for article in articles:
        if not article.entities:
            extract_entities(article)

        entity_set = set(article.entities)

        for market in active_markets:
            market_title = (market.get("title") or "").lower()
            market_words = set(re.findall(r'\b[a-z]{3,}\b', market_title))

            overlap = entity_set & market_words
            if len(overlap) >= min_overlap:
                # Score: overlap count / min(entity count, market word count)
                denominator = min(len(entity_set), len(market_words))
                score = len(overlap) / denominator if denominator > 0 else 0
                matches.append((article, market, score))

    matches.sort(key=lambda x: x[2], reverse=True)
    return matches


def score_news_impact(
    article: NewsArticle,
    market: dict,
    reasoning: ReasoningEngine,
) -> tuple[float, float, str]:
    """Use LLM to rate a news article's impact on a matched market.

    Args:
        article: The news article.
        market: The matched market dict.
        reasoning: ReasoningEngine instance.

    Returns:
        Tuple of (impact_score, confidence, reasoning_text).
    """
    prompt = (
        f"News article: {article.title}\n"
        f"Summary: {article.summary[:300]}\n"
        f"Source: {article.source}\n\n"
        f"Prediction market: {market.get('title', '?')}\n"
        f"Current YES price: {market.get('last_price') or market.get('yes_price') or '?'}c\n\n"
        f"Rate this article's impact on the market. "
        f"Positive = bullish for YES, negative = bearish for YES."
    )

    try:
        response = reasoning._client.chat.completions.create(
            model=reasoning._model,
            messages=[{"role": "user", "content": prompt}],
            functions=[NEWS_IMPACT_TOOL],
            function_call={"name": "submit_news_impact"},
        )
        raw = response.choices[0].message.function_call.arguments
        parsed = json.loads(raw)
        return (
            float(parsed.get("impact_score", 0)),
            float(parsed.get("confidence", 0)),
            str(parsed.get("reasoning", "")),
        )
    except Exception as e:
        logger.warning(f"News impact scoring failed: {e}")
        return (0.0, 0.0, "")


def run_news_scan(
    conn: sqlite3.Connection,
    reasoning: ReasoningEngine,
    config: Config,
    feed_urls: list[str] | None = None,
    max_matches: int = 5,
) -> list[NewsMatch]:
    """Full pipeline: fetch news → extract entities → match contracts → score impact.

    Args:
        conn: SQLite connection (to get active markets).
        reasoning: ReasoningEngine instance.
        config: Cipher config.
        feed_urls: Override feed URLs for testing.
        max_matches: Max matches to LLM-score.

    Returns:
        List of NewsMatch objects, sorted by impact confidence.
    """
    from cipher.db import get_active_markets

    articles = fetch_news_feeds(feed_urls)
    if not articles:
        logger.info("No news articles fetched")
        return []

    for article in articles:
        extract_entities(article)

    markets = get_active_markets(conn)
    market_dicts = [dict(m) for m in markets] if markets else []

    if not market_dicts:
        logger.info("No active markets to match against")
        return []

    raw_matches = match_to_contracts(articles, market_dicts)
    logger.info(f"Found {len(raw_matches)} raw news-market matches")

    # Score top matches via LLM
    results: list[NewsMatch] = []
    for article, market, match_score in raw_matches[:max_matches]:
        impact, confidence, reasoning_text = score_news_impact(article, market, reasoning)
        results.append(NewsMatch(
            article=article,
            market_id=market.get("id", ""),
            market_title=market.get("title", ""),
            match_score=match_score,
            impact_score=impact,
            impact_confidence=confidence,
            impact_reasoning=reasoning_text,
        ))

    results.sort(key=lambda x: x.impact_confidence, reverse=True)
    return results
```

- [ ] **Step 1.3.3: Update `news_timing` signal to use real data**

Replace `cipher/signals/news_timing.py`:

```python
"""Signal 4: News timing signal — powered by RSS feed matching."""
from __future__ import annotations

from dataclasses import dataclass


@dataclass
class NewsTimingResult:
    """Output of the news timing signal."""
    score: float        # Signal score in [-1, 1]
    confidence: float   # Confidence in [0, 1]
    available: bool     # Whether the signal has real data
    article_count: int = 0
    top_headline: str = ""


def compute_news_timing(
    news_impact_score: float = 0.0,
    news_confidence: float = 0.0,
    article_count: int = 0,
    top_headline: str = "",
) -> NewsTimingResult:
    """Compute the news timing signal.

    When news data is available (article_count > 0), uses the aggregated
    news impact score. Otherwise returns unavailable.

    Args:
        news_impact_score: Aggregated impact score from matched articles (-1 to 1).
        news_confidence: Aggregated confidence from news matching (0-1).
        article_count: Number of matched articles.
        top_headline: Title of the highest-impact matched article.

    Returns:
        NewsTimingResult with score, confidence, and availability flag.
    """
    if article_count == 0 or news_confidence == 0.0:
        return NewsTimingResult(score=0.0, confidence=0.0, available=False)

    # Clamp score to [-1, 1]
    score = max(-1.0, min(1.0, news_impact_score))
    confidence = max(0.0, min(1.0, news_confidence))

    return NewsTimingResult(
        score=score,
        confidence=confidence,
        available=True,
        article_count=article_count,
        top_headline=top_headline,
    )
```

- [ ] **Step 1.3.4: Add `news` telegram command**

In `cipher/telegram_bot.py`, add to routing:

```python
        elif t in ("news", "headlines", "articles"):
            return self._handle_news(conn)
```

Add handler:

```python
    def _handle_news(self, conn: sqlite3.Connection) -> str:
        """Show recent news-market matches."""
        try:
            from cipher.news import run_news_scan
            from cipher.reasoning import ReasoningEngine
            reasoning = ReasoningEngine(self.config)
            matches = run_news_scan(conn, reasoning, self.config, max_matches=3)
            if not matches:
                return "No news-market matches found. Feeds may be empty or no markets cached."
            lines = [f"*{len(matches)} news-market matches:*"]
            for m in matches:
                direction = "bullish" if m.impact_score > 0 else "bearish" if m.impact_score < 0 else "neutral"
                lines.append(
                    f"\n*{m.article.title[:60]}*\n"
                    f"  -> `{m.market_title[:50]}`\n"
                    f"  Impact: {direction} ({m.impact_score:+.2f}), "
                    f"conf: {m.impact_confidence:.0%}\n"
                    f"  _{m.impact_reasoning[:80]}_"
                )
            return "\n".join(lines)
        except Exception as e:
            return f"News scan failed: `{e}`"
```

Update help:

```python
            "- *news* — recent news-market matches\n"
```

- [ ] **Step 1.3.5: Test news module**

Create `tests/test_news.py`:

```python
"""Tests for cipher.news."""
import pytest

from cipher.news import (
    NewsArticle,
    extract_entities,
    fetch_news_feeds,
    match_to_contracts,
)
from cipher.signals.news_timing import compute_news_timing, NewsTimingResult


class TestExtractEntities:
    def test_extracts_title_words(self):
        article = NewsArticle(
            title="Federal Reserve Cuts Interest Rates Again",
            summary="The Fed announced another rate cut today.",
            link="", published="", source="Reuters",
        )
        entities = extract_entities(article)
        assert "federal" in entities
        assert "reserve" in entities
        assert "cuts" in entities
        assert "interest" in entities
        assert "rates" in entities
        # Stop words excluded
        assert "the" not in entities

    def test_extracts_proper_nouns_from_summary(self):
        article = NewsArticle(
            title="Tech stocks rally",
            summary="Nvidia Corporation and Taiwan Semiconductor saw big gains.",
            link="", published="", source="CNBC",
        )
        entities = extract_entities(article)
        assert "nvidia corporation" in entities or "taiwan semiconductor" in entities

    def test_empty_article(self):
        article = NewsArticle(title="", summary="", link="", published="", source="")
        entities = extract_entities(article)
        assert entities == []


class TestMatchToContracts:
    def test_basic_match(self):
        article = NewsArticle(
            title="Federal Reserve interest rate decision",
            summary="", link="", published="", source="Reuters",
            entities=["federal", "reserve", "interest", "rate", "decision"],
        )
        markets = [
            {"title": "Will the Federal Reserve cut interest rates in June?", "id": "FED-RATE-JUNE"},
            {"title": "Will the Lakers win the NBA Finals?", "id": "NBA-FINALS"},
        ]
        matches = match_to_contracts([article], markets, min_overlap=2)
        assert len(matches) >= 1
        assert matches[0][1]["id"] == "FED-RATE-JUNE"

    def test_no_match_below_threshold(self):
        article = NewsArticle(
            title="Weather forecast sunny",
            summary="", link="", published="", source="",
            entities=["weather", "forecast", "sunny"],
        )
        markets = [
            {"title": "Will Bitcoin reach 100k?", "id": "BTC-100K"},
        ]
        matches = match_to_contracts([article], markets, min_overlap=2)
        assert len(matches) == 0

    def test_empty_inputs(self):
        assert match_to_contracts([], []) == []
        assert match_to_contracts([], [{"title": "X", "id": "X"}]) == []


class TestNewsTimingSignal:
    def test_unavailable_without_data(self):
        result = compute_news_timing()
        assert result.available is False
        assert result.score == 0.0
        assert result.confidence == 0.0

    def test_with_data(self):
        result = compute_news_timing(
            news_impact_score=0.6,
            news_confidence=0.8,
            article_count=3,
            top_headline="Fed cuts rates",
        )
        assert result.available is True
        assert result.score == 0.6
        assert result.confidence == 0.8
        assert result.article_count == 3

    def test_clamping(self):
        result = compute_news_timing(
            news_impact_score=2.0,
            news_confidence=1.5,
            article_count=1,
        )
        assert result.score == 1.0
        assert result.confidence == 1.0
```

- [ ] **Step 1.3.6: Commit**

```
git add cipher/news.py cipher/signals/news_timing.py cipher/telegram_bot.py pyproject.toml tests/test_news.py
git commit -m "Add news-to-contract mapper: RSS feeds, entity extraction, LLM impact scoring"
```

---

## Task 1.4: Portfolio-Level Risk

Create `cipher/portfolio_risk.py` with correlation-based Kelly reduction via Ledoit-Wolf shrinkage.

- [ ] **Step 1.4.1: Add `scipy` to dependencies**

In `pyproject.toml`, add:

```toml
    "scipy>=1.13",
```

- [ ] **Step 1.4.2: Create `cipher/portfolio_risk.py`**

```python
"""Portfolio-level risk: covariance estimation and correlated-Kelly reduction."""
from __future__ import annotations

import logging
import sqlite3
from dataclasses import dataclass

import numpy as np

from cipher.db import get_all_trades, get_open_trades

logger = logging.getLogger("cipher.portfolio_risk")


@dataclass
class PortfolioRiskResult:
    """Result of portfolio-level risk assessment."""
    avg_correlation: float       # average pairwise correlation of open positions
    max_correlation: float       # max pairwise correlation
    kelly_multiplier: float      # multiplier to apply to Kelly fraction (0.25-1.0)
    n_positions: int
    correlation_matrix: list[list[float]] | None = None
    position_ids: list[str] | None = None


def _build_return_series(
    trades: list[sqlite3.Row],
    market_id: str,
    window: int = 60,
) -> np.ndarray | None:
    """Build a PnL return series for a market from its trade history.

    Uses trade entry/exit prices to construct a simple return series.
    Returns None if insufficient data.

    Args:
        trades: All trades from the database.
        market_id: Market ID to filter for.
        window: Max number of historical returns to include.

    Returns:
        numpy array of returns, or None.
    """
    market_trades = [
        t for t in trades
        if t["market_id"] == market_id and t["pnl"] is not None
    ]

    if not market_trades:
        return None

    returns = []
    for t in market_trades[-window:]:
        entry = float(t["entry_price"]) if t["entry_price"] else 0
        pnl = float(t["pnl"]) if t["pnl"] else 0
        if entry > 0:
            returns.append(pnl / entry)
        else:
            returns.append(0.0)

    if not returns:
        return None

    return np.array(returns, dtype=np.float64)


def compute_correlation_matrix(
    conn: sqlite3.Connection,
    window: int = 60,
) -> tuple[np.ndarray | None, list[str]]:
    """Compute correlation matrix of open position returns.

    Uses historical returns from all trades for each market that has an
    open position. Applies Ledoit-Wolf shrinkage to the covariance matrix.

    Args:
        conn: SQLite connection.
        window: Lookback window in number of trades.

    Returns:
        Tuple of (correlation_matrix, list_of_market_ids).
        Returns (None, []) if fewer than 2 open positions.
    """
    open_trades = get_open_trades(conn)
    if len(open_trades) < 2:
        return None, []

    all_trades = get_all_trades(conn)
    market_ids = list(set(t["market_id"] for t in open_trades))

    if len(market_ids) < 2:
        return None, []

    # Build return series for each market
    return_series: dict[str, np.ndarray] = {}
    for mid in market_ids:
        series = _build_return_series(all_trades, mid, window)
        if series is not None and len(series) >= 2:
            return_series[mid] = series

    valid_ids = list(return_series.keys())
    if len(valid_ids) < 2:
        return None, []

    # Align to common length (pad shorter series with zeros)
    max_len = max(len(s) for s in return_series.values())
    aligned = np.zeros((len(valid_ids), max_len), dtype=np.float64)
    for i, mid in enumerate(valid_ids):
        series = return_series[mid]
        aligned[i, -len(series):] = series

    # Shrink covariance
    cov = shrink_covariance(aligned)

    # Convert to correlation matrix
    std = np.sqrt(np.diag(cov))
    std[std == 0] = 1.0  # avoid division by zero
    corr = cov / np.outer(std, std)
    np.fill_diagonal(corr, 1.0)

    return corr, valid_ids


def shrink_covariance(
    returns: np.ndarray,
    method: str = "ledoit_wolf",
) -> np.ndarray:
    """Estimate covariance matrix with shrinkage.

    Args:
        returns: 2D array, shape (n_assets, n_observations).
        method: Shrinkage method. Only 'ledoit_wolf' supported.

    Returns:
        Shrunk covariance matrix, shape (n_assets, n_assets).
    """
    if method != "ledoit_wolf":
        raise ValueError(f"Unknown shrinkage method: {method}")

    try:
        from scipy.covariance import ledoit_wolf as _lw
        # scipy expects (n_samples, n_features) = (observations, assets)
        cov, _ = _lw(returns.T)
        return cov
    except ImportError:
        # Fallback: use sklearn if scipy doesn't have it
        try:
            from sklearn.covariance import LedoitWolf
            lw = LedoitWolf().fit(returns.T)
            return lw.covariance_
        except ImportError:
            pass

    # Last resort: numpy sample covariance
    logger.warning("No shrinkage library available, using sample covariance")
    return np.cov(returns)


def fractional_kelly(
    full_kelly_frac: float,
    avg_portfolio_correlation: float,
    threshold: float = 0.5,
    floor_multiplier: float = 0.25,
) -> float:
    """Reduce Kelly fraction when portfolio is correlated.

    When average pairwise correlation exceeds threshold, reduce the
    Kelly fraction to floor_multiplier * full_kelly. Linear interpolation
    between 1.0 and floor_multiplier as correlation rises from 0 to threshold.

    Args:
        full_kelly_frac: The raw Kelly fraction for this position.
        avg_portfolio_correlation: Average pairwise correlation (0-1).
        threshold: Correlation level at which floor kicks in.
        floor_multiplier: Minimum fraction of full Kelly to use.

    Returns:
        Adjusted Kelly fraction.
    """
    if avg_portfolio_correlation <= 0:
        return full_kelly_frac

    if avg_portfolio_correlation >= threshold:
        return full_kelly_frac * floor_multiplier

    # Linear interpolation
    ratio = avg_portfolio_correlation / threshold
    multiplier = 1.0 - ratio * (1.0 - floor_multiplier)
    return full_kelly_frac * multiplier


def assess_portfolio_risk(
    conn: sqlite3.Connection,
    window: int = 60,
) -> PortfolioRiskResult:
    """Full portfolio risk assessment.

    Args:
        conn: SQLite connection.
        window: Lookback window for return estimation.

    Returns:
        PortfolioRiskResult with correlation stats and Kelly multiplier.
    """
    open_trades = get_open_trades(conn)
    n = len(open_trades)

    if n < 2:
        return PortfolioRiskResult(
            avg_correlation=0.0,
            max_correlation=0.0,
            kelly_multiplier=1.0,
            n_positions=n,
        )

    corr_matrix, market_ids = compute_correlation_matrix(conn, window)

    if corr_matrix is None:
        return PortfolioRiskResult(
            avg_correlation=0.0,
            max_correlation=0.0,
            kelly_multiplier=1.0,
            n_positions=n,
            position_ids=list(set(t["market_id"] for t in open_trades)),
        )

    # Extract off-diagonal correlations
    n_assets = corr_matrix.shape[0]
    off_diag = []
    for i in range(n_assets):
        for j in range(i + 1, n_assets):
            off_diag.append(abs(corr_matrix[i, j]))

    avg_corr = float(np.mean(off_diag)) if off_diag else 0.0
    max_corr = float(np.max(off_diag)) if off_diag else 0.0

    # Determine Kelly multiplier
    kelly_mult = 1.0
    if avg_corr > 0.5:
        kelly_mult = 0.25
    elif avg_corr > 0:
        kelly_mult = 1.0 - (avg_corr / 0.5) * 0.75

    return PortfolioRiskResult(
        avg_correlation=avg_corr,
        max_correlation=max_corr,
        kelly_multiplier=kelly_mult,
        n_positions=n,
        correlation_matrix=corr_matrix.tolist(),
        position_ids=market_ids,
    )
```

- [ ] **Step 1.4.3: Wire portfolio risk into `evaluate()` in engine.py**

In `cipher/engine.py`, modify the `evaluate` function to accept and apply a portfolio risk multiplier. Add after the existing sizing step (Step 5):

```python
# In cipher/engine.py, add parameter to evaluate():
def evaluate(
    signals: SignalBundle,
    market_price: float,
    estimated_prob: float,
    bankroll: float,
    open_positions: int,
    portfolio_exposure: float,
    config: Optional[Config] = None,
    inference_cost: float = 0.10,
    portfolio_kelly_multiplier: float = 1.0,  # NEW: from portfolio_risk module
) -> Decision:
```

Then, after `position = compute_kelly(...)` and before the final `return Decision(...)` for the PITCH case, add:

```python
    # Apply portfolio-level risk adjustment to Kelly fraction
    if portfolio_kelly_multiplier < 1.0 and position.contracts > 0:
        adjusted_fraction = position.capped_fraction * portfolio_kelly_multiplier
        position = compute_kelly(
            estimated_prob, market_price, direction, bankroll,
            max_position_pct=adjusted_fraction,
        )
        if position.contracts == 0:
            return Decision(
                action="SKIP",
                direction=direction,
                combined_score=combined_score,
                confidence=confidence,
                position=None,
                rejection_reasons=["Portfolio correlation reduced Kelly to 0 contracts"],
                ev=tentative_ev,
                reasoning="Skipped: portfolio too correlated for new position",
            )
```

- [ ] **Step 1.4.4: Wire portfolio risk into daemon scoring**

In `cipher/daemon.py`, in the `_tick` function, before the scoring loop, compute portfolio risk:

```python
    # After computing portfolio_exposure and open_positions:

    # Portfolio risk assessment
    portfolio_kelly_mult = 1.0
    try:
        from cipher.portfolio_risk import assess_portfolio_risk
        risk = assess_portfolio_risk(conn)
        portfolio_kelly_mult = risk.kelly_multiplier
        if portfolio_kelly_mult < 1.0:
            logger.info(
                f"Portfolio risk: avg_corr={risk.avg_correlation:.2f}, "
                f"kelly_mult={portfolio_kelly_mult:.2f}"
            )
    except Exception as e:
        logger.warning(f"Portfolio risk assessment failed: {e}")
```

Then pass `portfolio_kelly_mult` through `_score_and_evaluate` to `evaluate()`. Add the parameter to `_score_and_evaluate`:

```python
async def _score_and_evaluate(
    conn: sqlite3.Connection,
    kalshi: KalshiClient,
    reasoning: ReasoningEngine,
    market: dict,
    bankroll: float,
    portfolio_exposure: float,
    open_positions: int,
    config: Config,
    portfolio_kelly_multiplier: float = 1.0,  # NEW
) -> Decision | None:
```

And pass it to the `evaluate()` call at the end of `_score_and_evaluate`:

```python
    return evaluate(
        signals=signals,
        market_price=market.get("last_price") or 50,
        estimated_prob=llm.true_probability,
        bankroll=bankroll,
        portfolio_exposure=portfolio_exposure,
        open_positions=open_positions,
        config=config,
        portfolio_kelly_multiplier=portfolio_kelly_multiplier,  # NEW
    )
```

- [ ] **Step 1.4.5: Test portfolio risk**

Create `tests/test_portfolio_risk.py`:

```python
"""Tests for cipher.portfolio_risk."""
import numpy as np
import pytest

from cipher.portfolio_risk import (
    PortfolioRiskResult,
    assess_portfolio_risk,
    fractional_kelly,
    shrink_covariance,
)


class TestFractionalKelly:
    def test_no_correlation(self):
        assert fractional_kelly(0.20, 0.0) == 0.20

    def test_high_correlation_floors(self):
        result = fractional_kelly(0.20, 0.6, threshold=0.5)
        assert result == pytest.approx(0.05, abs=0.001)  # 0.20 * 0.25

    def test_at_threshold(self):
        result = fractional_kelly(0.20, 0.5, threshold=0.5)
        assert result == pytest.approx(0.05, abs=0.001)

    def test_linear_interpolation(self):
        result = fractional_kelly(0.20, 0.25, threshold=0.5)
        # 0.25/0.5 = 0.5 ratio, multiplier = 1.0 - 0.5*0.75 = 0.625
        assert result == pytest.approx(0.125, abs=0.001)

    def test_negative_correlation(self):
        assert fractional_kelly(0.20, -0.3) == 0.20


class TestShrinkCovariance:
    def test_basic_shrinkage(self):
        np.random.seed(42)
        # 3 assets, 50 observations
        returns = np.random.randn(3, 50)
        cov = shrink_covariance(returns)
        assert cov.shape == (3, 3)
        # Should be symmetric
        np.testing.assert_array_almost_equal(cov, cov.T)
        # Diagonal should be positive
        assert all(cov[i, i] > 0 for i in range(3))

    def test_invalid_method(self):
        with pytest.raises(ValueError):
            shrink_covariance(np.array([[1, 2], [3, 4]]), method="invalid")


class TestAssessPortfolioRisk:
    def test_single_position(self, db):
        """Single position should return kelly_multiplier=1.0."""
        result = assess_portfolio_risk(db)
        assert result.kelly_multiplier == 1.0
        assert result.n_positions == 0

    def test_no_positions(self, db):
        result = assess_portfolio_risk(db)
        assert result.kelly_multiplier == 1.0
```

- [ ] **Step 1.4.6: Commit**

```
git add cipher/portfolio_risk.py cipher/engine.py cipher/daemon.py pyproject.toml tests/test_portfolio_risk.py
git commit -m "Add portfolio-level risk: Ledoit-Wolf covariance, fractional Kelly on correlated positions"
```

---

## Task 1.5: Weekly Substack Auto-Generator

Create `cipher/substack.py` to generate weekly performance reports in markdown.

- [ ] **Step 1.5.1: Create `cipher/substack.py`**

```python
"""Weekly Substack report generator for Cipher."""
from __future__ import annotations

import logging
import sqlite3
from datetime import datetime, timezone, timedelta
from pathlib import Path

from cipher.calibration import (
    compute_brier_score,
    compute_portfolio_metrics,
    compute_reliability_diagram,
)
from cipher.config import Config
from cipher.db import get_all_trades, get_recent_retros

logger = logging.getLogger("cipher.substack")

REPORTS_DIR = Path("~/.cipher/reports").expanduser()


def _get_week_trades(
    conn: sqlite3.Connection,
    days: int = 7,
) -> list[sqlite3.Row]:
    """Get trades closed in the last N days.

    Only includes closed trades (not open). Respects the 48h disclosure
    delay by excluding trades closed less than 48h ago.

    Args:
        conn: SQLite connection.
        days: Lookback period.

    Returns:
        List of trade rows.
    """
    now = datetime.now(timezone.utc)
    cutoff_start = now - timedelta(days=days)
    cutoff_end = now - timedelta(hours=48)  # 48h disclosure delay

    rows = conn.execute(
        """
        SELECT * FROM trades
        WHERE status IN ('won', 'lost', 'closed')
          AND closed_at IS NOT NULL
          AND closed_at >= ?
          AND closed_at <= ?
        ORDER BY closed_at
        """,
        (cutoff_start.isoformat(), cutoff_end.isoformat()),
    ).fetchall()
    return rows


def _get_week_retros(
    conn: sqlite3.Connection,
    days: int = 7,
) -> list[sqlite3.Row]:
    """Get retro lessons from the last N days."""
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    return conn.execute(
        """
        SELECT * FROM retros
        WHERE created_at >= ?
        ORDER BY created_at DESC
        """,
        (cutoff,),
    ).fetchall()


def generate_weekly_report(
    conn: sqlite3.Connection,
    config: Config,
) -> str:
    """Generate a weekly Substack post in markdown.

    Format:
    - P&L summary
    - Top wins and losses
    - Signal performance breakdown
    - Calibration update (Brier score)
    - Lessons learned from retros
    - Closed-positions-only, 48h delay on disclosure

    Args:
        conn: SQLite connection.
        config: Cipher config.

    Returns:
        Markdown-formatted weekly report string.
    """
    now = datetime.now(timezone.utc)
    week_num = now.isocalendar()[1]
    year = now.year

    week_trades = _get_week_trades(conn)
    all_trades = get_all_trades(conn)
    retros = _get_week_retros(conn)

    # Metrics for the week
    if week_trades:
        week_pnls = [float(t["pnl"] or 0) for t in week_trades]
        week_total_pnl = sum(week_pnls)
        week_wins = sum(1 for p in week_pnls if p > 0)
        week_losses = sum(1 for p in week_pnls if p < 0)
        week_win_rate = week_wins / len(week_trades) if week_trades else 0

        # Sort for top/bottom
        sorted_trades = sorted(week_trades, key=lambda t: float(t["pnl"] or 0), reverse=True)
        top_wins = sorted_trades[:3]
        top_losses = sorted_trades[-3:] if len(sorted_trades) > 3 else []
    else:
        week_total_pnl = 0
        week_wins = 0
        week_losses = 0
        week_win_rate = 0
        top_wins = []
        top_losses = []

    # All-time metrics
    portfolio = compute_portfolio_metrics(all_trades)

    # Brier score from all resolved trades
    predictions = []
    outcomes = []
    closed = [t for t in all_trades if t["status"] in ("won", "lost", "closed")]
    for t in closed:
        predictions.append(float(t["entry_price"]) if t["entry_price"] else 0.5)
        outcomes.append(1 if t["status"] == "won" else 0)
    brier = compute_brier_score(predictions, outcomes) if predictions else 1.0

    # Build markdown
    lines = [
        f"# Cipher Weekly Report — {year} W{week_num:02d}",
        "",
        f"*Generated {now.strftime('%Y-%m-%d %H:%M UTC')}*",
        "",
        f"> All positions shown are **closed**. Live positions are excluded with a 48-hour disclosure delay.",
        "",
        "---",
        "",
        "## P&L Summary",
        "",
        f"| Metric | This Week | All-Time |",
        f"|--------|-----------|----------|",
        f"| Trades | {len(week_trades)} | {portfolio.total_trades} |",
        f"| P&L | ${week_total_pnl:+.2f} | ${portfolio.total_pnl:+.2f} |",
        f"| Win Rate | {week_win_rate:.0%} ({week_wins}W/{week_losses}L) | {portfolio.win_rate:.0%} ({portfolio.wins}W/{portfolio.losses}L) |",
        "",
    ]

    if top_wins:
        lines.extend([
            "## Top Wins",
            "",
        ])
        for t in top_wins:
            if float(t["pnl"] or 0) > 0:
                lines.append(
                    f"- **{t['market_id'][:40]}** — ${float(t['pnl']):+.2f} "
                    f"({t['side']} {t['contracts']}x @ {float(t['entry_price']):.2f})"
                )
        lines.append("")

    if top_losses:
        lines.extend([
            "## Top Losses",
            "",
        ])
        for t in reversed(top_losses):
            if float(t["pnl"] or 0) < 0:
                lines.append(
                    f"- **{t['market_id'][:40]}** — ${float(t['pnl']):+.2f} "
                    f"({t['side']} {t['contracts']}x @ {float(t['entry_price']):.2f})"
                )
        lines.append("")

    lines.extend([
        "## Portfolio Metrics",
        "",
        f"| Metric | Value |",
        f"|--------|-------|",
        f"| Sharpe Ratio | {portfolio.sharpe_ratio:+.3f} |",
        f"| Sortino Ratio | {portfolio.sortino_ratio:+.3f} |",
        f"| Max Drawdown | ${portfolio.max_drawdown:.2f} ({portfolio.max_drawdown_pct:.1%}) |",
        f"| VaR (95%) | ${portfolio.var_95:+.2f} |",
        f"| VaR (99%) | ${portfolio.var_99:+.2f} |",
        f"| Profit Factor | {portfolio.profit_factor:.2f} |",
        "",
    ])

    lines.extend([
        "## Calibration",
        "",
        f"**Brier Score:** {brier:.4f}",
        f"*(0.00 = perfect, 0.25 = coin-flip baseline)*",
        "",
    ])

    bins = compute_reliability_diagram(predictions, outcomes) if predictions else []
    if bins:
        lines.extend([
            "| Predicted | Observed | Count |",
            "|-----------|----------|-------|",
        ])
        for b in bins:
            lines.append(
                f"| {b.mean_predicted:.2f} | {b.mean_observed:.2f} | {b.count} |"
            )
        lines.append("")

    if retros:
        lines.extend([
            "## Lessons Learned",
            "",
        ])
        for r in retros[:5]:
            lines.append(f"- {r['summary']}")
        lines.append("")

    lines.extend([
        "---",
        "",
        f"*Cipher is an autonomous prediction market agent. "
        f"Track record is live and auditable.*",
    ])

    return "\n".join(lines)


def save_weekly_report(
    conn: sqlite3.Connection,
    config: Config,
) -> Path:
    """Generate and save weekly report to disk.

    Saves to ~/.cipher/reports/YYYY-WXX-weekly.md.

    Args:
        conn: SQLite connection.
        config: Cipher config.

    Returns:
        Path to the saved report file.
    """
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)

    now = datetime.now(timezone.utc)
    week_num = now.isocalendar()[1]
    year = now.year
    filename = f"{year}-W{week_num:02d}-weekly.md"
    filepath = REPORTS_DIR / filename

    report = generate_weekly_report(conn, config)
    filepath.write_text(report)
    logger.info(f"Weekly report saved to {filepath}")

    return filepath
```

- [ ] **Step 1.5.2: Add `cipher weekly` CLI command**

In `cipher/cli.py`, add:

```python
@cli.command()
@click.option("--save/--no-save", default=True, help="Save report to ~/.cipher/reports/")
def weekly(save: bool) -> None:
    """Generate weekly Substack report."""
    config = Config.load()
    conn = init_db(config.db_path)
    try:
        if save:
            from cipher.substack import save_weekly_report
            path = save_weekly_report(conn, config)
            click.echo(f"Weekly report saved to: {path}")
            # Also print to stdout
            click.echo("")
            click.echo(path.read_text())
        else:
            from cipher.substack import generate_weekly_report
            report = generate_weekly_report(conn, config)
            click.echo(report)
    finally:
        conn.close()
```

- [ ] **Step 1.5.3: Add `weekly` telegram command**

In `cipher/telegram_bot.py`, add to routing:

```python
        elif t in ("weekly", "report", "substack"):
            return self._handle_weekly(conn)
```

Add handler:

```python
    def _handle_weekly(self, conn: sqlite3.Connection) -> str:
        """Generate and return weekly report summary."""
        try:
            from cipher.substack import save_weekly_report
            path = save_weekly_report(conn, self.config)
            # Read back and truncate for Telegram
            report = path.read_text()
            if len(report) > 3900:
                report = report[:3900] + "\n\n...(truncated, full report at " + str(path) + ")"
            return report
        except Exception as e:
            return f"Weekly report generation failed: `{e}`"
```

Update help:

```python
            "- *weekly* — generate Substack weekly report\n"
```

- [ ] **Step 1.5.4: Test substack module**

Create `tests/test_substack.py`:

```python
"""Tests for cipher.substack."""
from pathlib import Path

import pytest

from cipher.config import Config
from cipher.db import init_db, insert_trade, resolve_trade
from cipher.substack import generate_weekly_report, save_weekly_report


@pytest.fixture
def db(tmp_path):
    return init_db(tmp_path / "test.db")


class TestGenerateWeeklyReport:
    def test_empty_report(self, db):
        config = Config()
        report = generate_weekly_report(db, config)
        assert "Cipher Weekly Report" in report
        assert "P&L Summary" in report
        assert "Calibration" in report

    def test_with_trades(self, db):
        # Insert market
        db.execute(
            "INSERT INTO markets (id, title, category, close_time, updated_at) "
            "VALUES ('M1', 'Test Market', 'politics', '2026-05-01', '2026-04-22')"
        )
        db.commit()

        # Insert and resolve a trade
        from cipher.db import now_iso
        t1 = insert_trade(db, market_id="M1", side="YES", contracts=2, entry_price=0.40)
        resolve_trade(db, t1, exit_price=1.0, pnl=1.20, status="won")

        config = Config()
        report = generate_weekly_report(db, config)
        assert "Cipher Weekly Report" in report
        assert "Portfolio Metrics" in report
        assert "Sharpe" in report


class TestSaveWeeklyReport:
    def test_saves_to_disk(self, db, tmp_path):
        config = Config()
        import cipher.substack as mod
        original = mod.REPORTS_DIR
        mod.REPORTS_DIR = tmp_path / "reports"
        try:
            path = save_weekly_report(db, config)
            assert path.exists()
            content = path.read_text()
            assert "Cipher Weekly Report" in content
            assert path.name.endswith("-weekly.md")
        finally:
            mod.REPORTS_DIR = original
```

- [ ] **Step 1.5.5: Commit**

```
git add cipher/substack.py cipher/cli.py cipher/telegram_bot.py tests/test_substack.py
git commit -m "Add weekly Substack auto-generator: P&L, metrics, calibration, lessons"
```

---

## Final: Integration Verification

- [ ] **Step F.1: Run full test suite**

```bash
cd ~/repos/cipher && python -m pytest tests/ -v
```

Fix any failures before proceeding.

- [ ] **Step F.2: Verify all new modules import cleanly**

```bash
cd ~/repos/cipher && python -c "
from cipher.scanner import scan_markets
from cipher.calibration import generate_calibration_report
from cipher.thesis import get_active_theses, match_market_to_thesis
from cipher.news import fetch_news_feeds, extract_entities, match_to_contracts
from cipher.portfolio_risk import assess_portfolio_risk, fractional_kelly
from cipher.substack import generate_weekly_report
print('All V2 core modules import successfully.')
"
```

- [ ] **Step F.3: Verify new CLI commands register**

```bash
cd ~/repos/cipher && cipher --help
```

Should show: `calibration`, `weekly` alongside existing commands.

- [ ] **Step F.4: Install new dependencies**

```bash
cd ~/repos/cipher && pip install -e ".[dev]"
```

Verify `feedparser`, `scipy`, `pyyaml` install without conflict.

- [ ] **Step F.5: Final commit with version bump**

Update `cipher/__init__.py`:

```python
__version__ = "0.2.0"
```

Update `pyproject.toml`:

```toml
version = "0.2.0"
```

```
git add cipher/__init__.py pyproject.toml
git commit -m "Bump version to 0.2.0 — V2 core complete"
```
