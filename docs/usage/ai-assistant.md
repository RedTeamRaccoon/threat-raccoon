---
layout: page
title: AI assistant and MCP
nav_order: 6
path: /usage/ai-assistant
group: Modeling
---

## AI assistant and native MCP

Threat Dragon includes a built-in AI assistant that lets you **chat with an AI agent, share application design
documents, and collaboratively build a threat model that is drawn live on the diagram canvas** — elements, data
flows, trust boundaries and STRIDE threats appear as the agent works. The same threat-model operations are
exposed as a native [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server, so external MCP
clients such as Claude Desktop, Claude Code or Cursor can drive Threat Dragon directly.

> This is distinct from the third-party [Threat Dragon AI Tool]({{ '/usage/ai-tool.html' | relative_url }}),
> which is a separate desktop application. The assistant described here is built into Threat Dragon itself.

The agent only ever acts through a fixed set of threat-modeling operations (create diagram, add element, connect
flow, add boundary, add threat, update, remove, list threats, validate, summarize). Each operation is validated
against the Threat Dragon v2 schema, so the model it produces is always well-formed and openable in the editor.

### Two modes

| | Server mode | Desktop mode |
| --- | --- | --- |
| Where it runs | Web app / Docker | Electron desktop app |
| Provider key | One key configured server-side, shared by signed-in users | Bring-your-own key, stored encrypted locally |
| Access control | Gated behind the existing login (JWT) | Local only |
| MCP transport | Authenticated HTTP endpoint (`/api/mcp`) | Local `stdio` server |

Both modes ship together; the same chat panel and operations are used in each.

### Supported providers

Anthropic (`claude-opus-4-8`), OpenAI, GitHub Copilot and Claude Code (OAuth). Only providers that have a key
configured are offered in the assistant's provider selector.

## Server mode

### Enable it

Set the AI environment variables (see the
[environment configuration]({{ '/configure/configure.html#ai-assistant-and-mcp-environment' | relative_url }})),
at minimum:

```dotenv
LLM_ENABLED=true
LLM_PROVIDER=anthropic
LLM_ANTHROPIC_API_KEY=sk-ant-...
MCP_HTTP_ENABLED=true
```

Only enablement flags and provider metadata are exposed through `/api/config` — **keys are never sent to the
browser**. In a shared deployment the one configured key is used on behalf of all signed-in users; set
`LLM_ALLOW_USER_KEY=true` if you want individual users to be able to supply their own key instead.

### Use it

1. Sign in and open (or create) a threat model and a diagram.
2. Open the **AI assistant** panel from the toggle in the diagram editor toolbar.
3. Optionally attach one or more application design documents (text or images), or paste them in.
4. Describe what you want — for example *"Build a STRIDE threat model of this system."*
5. Watch the agent build the diagram on the canvas. You can stop it at any time, then continue editing
   manually, ask for changes, or save.

## Desktop mode

In the desktop application there is no backend, so you provide your own API key:

1. Open **File → AI settings** (or the settings entry in the assistant panel).
2. Choose a provider and paste your API key. The key is stored encrypted using the operating system keyring
   (Electron `safeStorage`) — if no keyring is available the key is not persisted rather than stored in clear text.
3. Use the assistant exactly as in server mode.

## Native MCP server

The same operations are available to any MCP client.

### Local (stdio)

Point your MCP client at the bundled stdio entry, with the model file to edit:

```json
{
  "mcpServers": {
    "threat-dragon": {
      "command": "node",
      "args": ["/path/to/threat-dragon/td.server/src/mcp/stdioEntry.js"],
      "env": { "TD_MODEL_FILE": "/path/to/model.json" }
    }
  }
}
```

The agent then reads and writes that `.json` model through the MCP tools; open it in Threat Dragon to view the
result.

### Hosted (HTTP)

When `MCP_HTTP_ENABLED=true`, an authenticated Streamable-HTTP MCP endpoint is served at `/api/mcp`. It uses the
same bearer authentication as the rest of the API, requests are `Origin`-checked against `MCP_ALLOWED_ORIGINS`
(DNS-rebinding protection), and each session is bound to the authenticated user that created it, so a session
cannot be reused across users. The target model is taken from the authenticated request, not from tool arguments.

## Notes on diagram quality

Because every element is created through an operation that requires a canvas position (and the agent is prompted
to lay the diagram out as it builds), generated models are spread out and readable rather than stacked. Trust
boundaries are placed behind the other components — both when built and again when a model is loaded — so they
never block interaction with the elements inside them.
