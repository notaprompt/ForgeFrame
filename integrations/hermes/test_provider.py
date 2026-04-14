"""Tests for ForgeFrameProvider."""
import json
import subprocess
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch, call

import pytest

# Allow import without installing as a package
sys.path.insert(0, str(Path(__file__).parent))
from forgeframe_provider import ForgeFrameProvider


# ---------------------------------------------------------------------------
# Instantiation
# ---------------------------------------------------------------------------

def test_instantiation():
    """Provider can be created with an explicit (nonexistent) server path."""
    provider = ForgeFrameProvider(server_path="/nonexistent/path")
    assert provider is not None


def test_instantiation_with_db_path():
    """Provider stores db_path for subprocess env injection."""
    provider = ForgeFrameProvider(server_path="/nonexistent/path", db_path="/tmp/test.db")
    assert provider._db_path == "/tmp/test.db"


def test_find_server_raises_when_missing(tmp_path):
    """_find_server raises FileNotFoundError when server is not built."""
    # Temporarily patch __file__ so the search base points at tmp_path
    provider = ForgeFrameProvider.__new__(ForgeFrameProvider)
    provider._db_path = None
    provider._process = None
    provider._request_id = 0
    # Override _find_server via monkeypatching the lookup path
    with patch("forgeframe_provider.Path") as mock_path:
        mock_path.return_value.resolve.return_value.parent.parent.parent = tmp_path
        mock_server = tmp_path / "packages" / "server" / "dist" / "index.js"
        # File does not exist — expect FileNotFoundError
        with pytest.raises(FileNotFoundError):
            ForgeFrameProvider()


# ---------------------------------------------------------------------------
# Interface contract
# ---------------------------------------------------------------------------

def test_implements_interface():
    """Provider has all required lifecycle methods."""
    provider = ForgeFrameProvider(server_path="/nonexistent/path")
    for method in ("initialize", "prefetch", "sync_turn", "on_session_end", "on_pre_compress"):
        assert callable(getattr(provider, method, None)), f"Missing method: {method}"


# ---------------------------------------------------------------------------
# _call_tool
# ---------------------------------------------------------------------------

def _make_provider_with_mock_process(response: dict) -> ForgeFrameProvider:
    """Return a provider whose subprocess is replaced with a mock."""
    provider = ForgeFrameProvider(server_path="/fake/index.js")
    mock_proc = MagicMock()
    mock_proc.stdin = MagicMock()
    mock_proc.stdout = MagicMock()
    mock_proc.stdout.readline.return_value = json.dumps(response).encode()
    provider._process = mock_proc
    return provider


def test_call_tool_sends_jsonrpc():
    """_call_tool writes a well-formed JSON-RPC 2.0 message."""
    provider = _make_provider_with_mock_process({"result": {"content": [{"type": "text", "text": "ok"}]}})
    provider._call_tool("memory_save", {"content": "hello", "tags": ["test"]})

    written = provider._process.stdin.write.call_args[0][0]
    payload = json.loads(written.rstrip(b"\n"))
    assert payload["jsonrpc"] == "2.0"
    assert payload["method"] == "tools/call"
    assert payload["params"]["name"] == "memory_save"
    assert payload["params"]["arguments"]["content"] == "hello"


def test_call_tool_increments_request_id():
    """Each _call_tool call uses a unique, incrementing id."""
    provider = _make_provider_with_mock_process({"result": {}})
    provider._call_tool("guardian_temp", {})
    provider._call_tool("guardian_temp", {})
    assert provider._request_id == 2


def test_call_tool_raises_when_not_initialized():
    """_call_tool raises RuntimeError if initialize() was never called."""
    provider = ForgeFrameProvider(server_path="/fake/index.js")
    with pytest.raises(RuntimeError, match="not initialized"):
        provider._call_tool("memory_save", {})


# ---------------------------------------------------------------------------
# prefetch
# ---------------------------------------------------------------------------

def _guardian_response(state: str) -> dict:
    return {"result": {"content": [{"type": "text", "text": json.dumps({"state": state, "value": 0.1})}]}}


def test_prefetch_calm_is_noop():
    """prefetch with calm state does not modify context."""
    provider = _make_provider_with_mock_process(_guardian_response("calm"))
    ctx: dict = {}
    provider.prefetch(ctx)
    assert "reduced_scope" not in ctx


def test_prefetch_warm_sets_reduced_scope():
    """prefetch with warm state sets context['reduced_scope'] = True."""
    provider = _make_provider_with_mock_process(_guardian_response("warm"))
    ctx: dict = {}
    provider.prefetch(ctx)
    assert ctx.get("reduced_scope") is True


def test_prefetch_trapped_raises():
    """prefetch with trapped state raises RuntimeError."""
    provider = _make_provider_with_mock_process(_guardian_response("trapped"))
    with pytest.raises(RuntimeError, match="trapped"):
        provider.prefetch({})


def test_prefetch_bad_json_defaults_to_calm():
    """prefetch with unparseable guardian response does not raise."""
    bad_response = {"result": {"content": [{"type": "text", "text": "not-json"}]}}
    provider = _make_provider_with_mock_process(bad_response)
    ctx: dict = {}
    provider.prefetch(ctx)  # Should not raise
    assert "reduced_scope" not in ctx


# ---------------------------------------------------------------------------
# sync_turn
# ---------------------------------------------------------------------------

def test_sync_turn_saves_memories():
    """sync_turn calls memory_save for each new memory."""
    saved_calls = []

    def fake_call_tool(name, arguments):
        saved_calls.append((name, arguments))
        return {}

    provider = ForgeFrameProvider(server_path="/fake/index.js")
    provider._call_tool = fake_call_tool

    ctx = {
        "new_memories": [
            {"content": "Python is great", "tags": ["note"]},
            {"content": "Use type hints", "tags": [], "type": "skill"},
        ]
    }
    provider.sync_turn(ctx)

    assert len(saved_calls) == 2
    assert saved_calls[0] == ("memory_save", {"content": "Python is great", "tags": ["note"]})
    # skill type should add 'skill' tag
    name, args = saved_calls[1]
    assert name == "memory_save"
    assert "skill" in args["tags"]


def test_sync_turn_adds_skill_tag_from_type():
    """sync_turn adds 'skill' tag when memory type is 'skill'."""
    saved_calls = []

    provider = ForgeFrameProvider(server_path="/fake/index.js")
    provider._call_tool = lambda n, a: saved_calls.append((n, a)) or {}

    provider.sync_turn({"new_memories": [{"content": "foo", "tags": [], "type": "skill"}]})
    _, args = saved_calls[0]
    assert "skill" in args["tags"]


def test_sync_turn_no_duplicate_skill_tag():
    """sync_turn does not duplicate the 'skill' tag if already present."""
    saved_calls = []
    provider = ForgeFrameProvider(server_path="/fake/index.js")
    provider._call_tool = lambda n, a: saved_calls.append((n, a)) or {}

    provider.sync_turn({"new_memories": [{"content": "foo", "tags": ["skill"]}]})
    _, args = saved_calls[0]
    assert args["tags"].count("skill") == 1


def test_sync_turn_noop_on_empty():
    """sync_turn with no new_memories makes no tool calls."""
    calls = []
    provider = ForgeFrameProvider(server_path="/fake/index.js")
    provider._call_tool = lambda n, a: calls.append((n, a))

    provider.sync_turn({})
    assert calls == []


def test_sync_turn_passes_optional_fields():
    """sync_turn forwards metadata and valence when present."""
    saved = []
    provider = ForgeFrameProvider(server_path="/fake/index.js")
    provider._call_tool = lambda n, a: saved.append((n, a)) or {}

    provider.sync_turn({"new_memories": [{
        "content": "grounding thought",
        "tags": [],
        "metadata": {"source": "journal"},
        "valence": "grounding",
    }]})
    _, args = saved[0]
    assert args["metadata"] == {"source": "journal"}
    assert args["valence"] == "grounding"


# ---------------------------------------------------------------------------
# on_pre_compress
# ---------------------------------------------------------------------------

def test_on_pre_compress_saves_summary():
    """on_pre_compress saves the session summary with correct tags."""
    saved = []
    provider = ForgeFrameProvider(server_path="/fake/index.js")
    provider._call_tool = lambda n, a: saved.append((n, a)) or {}

    provider.on_pre_compress({"summary": "We fixed the auth bug."})
    assert len(saved) == 1
    name, args = saved[0]
    assert name == "memory_save"
    assert "We fixed the auth bug." in args["content"]
    assert "session-summary" in args["tags"]
    assert "hermes" in args["tags"]


def test_on_pre_compress_noop_on_empty_summary():
    """on_pre_compress makes no calls when summary is absent."""
    calls = []
    provider = ForgeFrameProvider(server_path="/fake/index.js")
    provider._call_tool = lambda n, a: calls.append((n, a))

    provider.on_pre_compress({})
    assert calls == []


# ---------------------------------------------------------------------------
# on_session_end
# ---------------------------------------------------------------------------

def test_on_session_end_terminates_process():
    """on_session_end terminates the subprocess."""
    provider = _make_provider_with_mock_process(_guardian_response("calm"))
    mock_proc = provider._process
    provider.on_session_end()
    mock_proc.terminate.assert_called_once()
    assert provider._process is None


def test_on_session_end_kills_on_timeout():
    """on_session_end kills the process if terminate times out."""
    provider = ForgeFrameProvider(server_path="/fake/index.js")
    mock_proc = MagicMock()
    mock_proc.stdin = MagicMock()
    mock_proc.stdout = MagicMock()
    mock_proc.stdout.readline.return_value = json.dumps(_guardian_response("calm")).encode()
    mock_proc.wait.side_effect = subprocess.TimeoutExpired(cmd="node", timeout=5)
    provider._process = mock_proc

    provider.on_session_end()
    mock_proc.kill.assert_called_once()
    assert provider._process is None


def test_on_session_end_noop_when_not_initialized():
    """on_session_end is safe to call before initialize()."""
    provider = ForgeFrameProvider(server_path="/fake/index.js")
    provider.on_session_end()  # Should not raise
