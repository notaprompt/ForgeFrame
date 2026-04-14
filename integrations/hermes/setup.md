# Hermes + ForgeFrame Setup

## Prerequisites

- Node.js 20+
- Python 3.11+
- Ollama with gemma4-27b-moe and gemma4-31b-dense pulled
- ForgeFrame built (`cd /path/to/ForgeFrame && npm install && npm run build`)
- hermes-agent installed (`pip install hermes-agent`)

## Installation

1. Install the ForgeFrame provider:
   ```bash
   cd integrations/hermes
   pip install -r requirements.txt
   ```

2. Copy config to Hermes config directory:
   ```bash
   cp config.yaml ~/.hermes/config.yaml
   ```

3. Set environment variables:
   ```bash
   export FORGEFRAME_DB_PATH=~/.forgeframe/memory.db
   export OLLAMA_KEEP_ALIVE=5m
   ```

## Model Setup

Pull required Ollama models:
```bash
ollama pull gemma4:27b-moe
ollama pull gemma4:31b-dense
```

## Verification

Test the MCP connection:
```bash
echo '{"jsonrpc":"2.0","method":"tools/list","id":1}' | node packages/server/dist/index.js
```

Test the provider:
```bash
cd integrations/hermes
python -m pytest test_provider.py -v
```

## Architecture

Hermes (motor) handles task execution. ForgeFrame (brain) handles memory and cognition.
MCP is the only interface between them. Neither controls the other's rhythm.

All dream operations use local models only -- cognitive data never leaves the machine.
