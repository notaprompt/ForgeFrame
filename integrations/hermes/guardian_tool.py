"""Guardian temperature tool for Hermes agent framework."""

import json

GUARDIAN_TOOL_SCHEMA = {
    "name": "guardian_check",
    "description": "Check ForgeFrame Guardian cognitive temperature. Returns calm/warm/trapped with behavioral guidance.",
    "parameters": {
        "type": "object",
        "properties": {},
        "required": [],
    },
}

STATE_INSTRUCTIONS = {
    "calm": "System is healthy. Proceed normally with full scope.",
    "warm": "Cognitive load elevated. Reduce scope -- prioritize critical tasks, defer exploration.",
    "trapped": "System is in a trapped state. Halt all non-essential operations. Do not save new memories.",
}


def guardian_check_handler(provider) -> dict:
    """Handler for guardian_check tool.

    Args:
        provider: ForgeFrameProvider instance with active MCP connection

    Returns:
        dict with 'state' (calm/warm/trapped) and 'instruction' (human-readable guidance)
    """
    try:
        response = provider._call_tool("guardian_temp", {})
        raw = provider._extract_text(response)
        data = json.loads(raw)
        state = data.get("state", "calm")
    except Exception:
        state = "calm"  # Safe default -- don't block Hermes on Guardian failure

    return {
        "state": state,
        "instruction": STATE_INSTRUCTIONS.get(state, STATE_INSTRUCTIONS["calm"]),
    }
