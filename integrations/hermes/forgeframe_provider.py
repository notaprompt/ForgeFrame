"""ForgeFrame MemoryProvider for Hermes agent framework."""

import json
import os
import subprocess
from pathlib import Path
from typing import Any, Optional

# Hermes imports -- available when installed alongside hermes-agent
try:
    from hermes.memory import MemoryProvider
except ImportError:
    # Stub for development/testing without hermes installed
    class MemoryProvider:
        """Stub ABC for development."""
        def initialize(self) -> None: ...
        def prefetch(self, context: Any) -> None: ...
        def sync_turn(self, context: Any) -> None: ...
        def on_session_end(self) -> None: ...
        def on_pre_compress(self, context: Any) -> None: ...


class ForgeFrameProvider(MemoryProvider):
    """Routes Hermes memory operations through ForgeFrame MCP server.

    Communicates with the ForgeFrame MCP server via JSON-RPC 2.0 over stdio.
    The server is started as a subprocess on initialize() and terminated on
    on_session_end().

    Boundary rule: Hermes never triggers consolidation, contradiction scanning,
    or dreaming directly. ForgeFrame never executes tasks. MCP is the only
    interface between them.
    """

    def __init__(self, server_path: Optional[str] = None, db_path: Optional[str] = None):
        self._server_path = server_path or self._find_server()
        self._db_path = db_path
        self._process: Optional[subprocess.Popen] = None
        self._request_id = 0

    def _find_server(self) -> str:
        """Locate the ForgeFrame MCP server relative to this file."""
        base = Path(__file__).resolve().parent.parent.parent
        server = base / "packages" / "server" / "dist" / "index.js"
        if server.exists():
            return str(server)
        raise FileNotFoundError(
            f"ForgeFrame server not found at {server}. "
            "Pass server_path explicitly or build the server first."
        )

    def initialize(self) -> None:
        """Start ForgeFrame MCP server as stdio subprocess."""
        env = {**os.environ}
        if self._db_path:
            env["FORGEFRAME_DB_PATH"] = self._db_path

        self._process = subprocess.Popen(
            ["node", self._server_path],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=env,
        )

    def _call_tool(self, name: str, arguments: dict) -> dict:
        """Send a JSON-RPC 2.0 tools/call to the MCP server and return the response."""
        if not self._process or not self._process.stdin or not self._process.stdout:
            raise RuntimeError("MCP server not initialized — call initialize() first")

        self._request_id += 1
        request = {
            "jsonrpc": "2.0",
            "method": "tools/call",
            "params": {"name": name, "arguments": arguments},
            "id": self._request_id,
        }

        payload = json.dumps(request).encode() + b"\n"
        self._process.stdin.write(payload)
        self._process.stdin.flush()

        line = self._process.stdout.readline()
        if not line:
            raise RuntimeError("MCP server closed stdout unexpectedly")
        return json.loads(line)

    def _extract_text(self, response: dict) -> str:
        """Pull the text content out of an MCP tool response."""
        return (
            response
            .get("result", {})
            .get("content", [{}])[0]
            .get("text", "")
        )

    def prefetch(self, context: Any) -> None:
        """Check Guardian temperature before a Hermes turn.

        - trapped → raises RuntimeError, halting the turn
        - warm    → sets context["reduced_scope"] = True so Hermes narrows its search
        - calm    → no-op
        """
        response = self._call_tool("guardian_temp", {})
        raw = self._extract_text(response)

        try:
            temp_obj = json.loads(raw)
            state = temp_obj.get("state", "calm")
        except (json.JSONDecodeError, AttributeError):
            state = "calm"

        if state == "trapped":
            raise RuntimeError("Guardian is trapped — halting Hermes turn")
        if state == "warm":
            if isinstance(context, dict):
                context["reduced_scope"] = True

    def sync_turn(self, context: Any) -> None:
        """Route memory saves from a completed Hermes turn through ForgeFrame MCP.

        Auto-link, TRIM tagging, and Hebbian wiring all happen server-side.
        Skill saves are tagged with ['skill'] unconditionally.
        """
        if not isinstance(context, dict):
            return

        memories = context.get("new_memories", [])
        for mem in memories:
            tags = list(mem.get("tags", []))
            if "skill" in tags or mem.get("type") == "skill":
                tags = list(set(tags + ["skill"]))

            arguments: dict = {
                "content": mem["content"],
                "tags": tags,
            }
            # Pass through optional fields if present
            if "metadata" in mem:
                arguments["metadata"] = mem["metadata"]
            if "valence" in mem:
                arguments["valence"] = mem["valence"]

            self._call_tool("memory_save", arguments)

    def on_session_end(self) -> None:
        """Inform ForgeFrame the session is ending, then shut down the subprocess.

        ForgeFrame decides independently whether to trigger NREM — we just
        signal via guardian_temp so it has fresh cognitive state before shutdown.
        """
        try:
            self._call_tool("guardian_temp", {})
        except Exception:
            pass
        finally:
            if self._process:
                self._process.terminate()
                try:
                    self._process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    self._process.kill()
                self._process = None

    def on_pre_compress(self, context: Any) -> None:
        """Save a session snapshot before Hermes compresses its context window."""
        if not isinstance(context, dict):
            return
        summary = context.get("summary", "")
        if summary:
            self._call_tool("memory_save", {
                "content": f"Session summary (pre-compress): {summary}",
                "tags": ["session-summary", "hermes"],
            })
