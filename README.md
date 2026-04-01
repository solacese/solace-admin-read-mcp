# solace-admin-read-mcp

> **Read-only MCP server for Solace PubSub+ brokers and Event Portal.**
> Give Claude direct access to your queue depths, client connections, VPN stats, event schemas, and more.

[![Node.js 20+](https://img.shields.io/badge/node-20%2B-brightgreen)](#prerequisites)
[![MCP SDK v2](https://img.shields.io/badge/MCP_SDK-v2-blue)](#)
[![Read-only](https://img.shields.io/badge/access-read--only-orange)](#what-the-server-cannot-do)
[![License: MIT](https://img.shields.io/badge/license-MIT-yellow)](#)

---

## What you can ask Claude

Once connected, try prompts like:

- *"List all queues and tell me which ones have messages backed up"*
- *"What topics are routed to the `orders.fulfillment` queue?"*
- *"Who is connected to the broker right now?"*
- *"Show me all events in the Payments domain and their schemas"*
- *"What does the OrderCreated schema look like?"*

Claude will call the right tools, combine results across SEMP and Event Portal, and give you a coherent answer.

---

## Available Tools

### Broker Tools (SEMP v2)

All broker tools accept optional `vpn` and `select` parameters. Use `select` to return only specific fields and keep Claude's context lean (e.g. `select: "queueName,spooledMsgCount"`).

| Tool | What it returns |
|---|---|
| `list_queues` | Every queue with its config: access type, max spool, owner, ingress/egress state |
| `get_queue_stats` | Live stats for one queue: spool depth, consumer count, message rates, byte counts |
| `get_queue_subscriptions` | Topic subscriptions attached to a queue — essential for understanding message routing |
| `list_client_connections` | Currently connected clients: name, username, IP, software version, uptime |
| `get_vpn_stats` | Aggregate VPN health: total message counts, spool usage, connection counts |
| `list_topic_endpoints` | All topic endpoints and their configuration |

### Event Portal Tools

Registered only when `SOLACE_CLOUD_TOKEN` is configured. All list tools accept optional `domainId` for filtering.

| Tool | What it returns |
|---|---|
| `list_application_domains` | All domains — the top-level grouping; use domain IDs to filter other tools |
| `list_applications` | Modeled applications that produce/consume events |
| `get_application_version` | Deep dive into a version: produced events, consumed events, consumers |
| `list_events` | Design-time events (message types) with name, topic address, schema refs |
| `list_schemas` | Schema catalog (JSON Schema, Avro, Protobuf) with name and version info |
| `get_schema_version` | The actual schema content for a specific version |
| `list_event_api_products` | Event API Products bundled for the developer portal |

---

## Transport Modes

| Mode | Use case | Auth |
|---|---|---|
| `stdio` | Local use with Claude Desktop or Claude Code | Process isolation, no network |
| `http` | Remote, shared, or containerized deployments | Bearer API key, per-request validation |

The HTTP transport implements the current MCP specification's **Streamable HTTP** protocol (not deprecated SSE).

---

## Quick Start

### Prerequisites

- **Node.js 20+**
- A **Solace PubSub+ broker** (Cloud or self-hosted)
- A **Solace Cloud token** (optional, for Event Portal tools)

### 1. Install

```bash
git clone https://github.com/solacese/solace-admin-read-mcp.git
cd solace-admin-read-mcp
npm install
npm run build
```

### 2. Configure

```bash
cp .env.example .env
# Edit .env with your credentials (see "Getting Credentials" below)
```

### 3. Register with Claude

**Claude Desktop (stdio):**

Add to your `claude_desktop_config.json` ([location by OS](#config-file-locations)):

```json
{
  "mcpServers": {
    "solace-admin": {
      "command": "node",
      "args": ["/absolute/path/to/solace-admin-read-mcp/dist/server.js"],
      "env": {
        "TRANSPORT": "stdio",
        "SEMP_BASE_URL": "https://your-broker:943/SEMP/v2",
        "SEMP_USERNAME": "readonly-semp-user",
        "SEMP_PASSWORD": "your-password",
        "SOLACE_VPN": "default",
        "SOLACE_CLOUD_TOKEN": "your-token"
      }
    }
  }
}
```

**Claude Code CLI:**

```bash
claude mcp add solace-admin \
  -e TRANSPORT=stdio \
  -e SEMP_BASE_URL=https://your-broker:943/SEMP/v2 \
  -e SEMP_USERNAME=readonly-semp-user \
  -e SEMP_PASSWORD=your-password \
  -e SOLACE_VPN=default \
  -e SOLACE_CLOUD_TOKEN=your-token \
  -- node /absolute/path/to/solace-admin-read-mcp/dist/server.js
```

**HTTP mode (remote):**

```bash
# Start the server
TRANSPORT=http MCP_API_KEY=<your-key> npm start
```

```json
{
  "mcpServers": {
    "solace-admin": {
      "url": "http://localhost:3000/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_MCP_API_KEY"
      }
    }
  }
}
```

---

## Getting Credentials

### SEMP v2 (Broker)

SEMP v2 is the broker's REST management API using HTTP Basic Auth.

**Solace Cloud:**
1. [console.solace.cloud](https://console.solace.cloud) -> your service -> **Connect** tab
2. Expand **Management** credentials -> copy username, password, and host
3. Your `SEMP_BASE_URL` is `https://<management-host>/SEMP/v2`

> **Tip:** Create a dedicated read-only user under **Manage** -> **Access Control** -> **Management Users** -> set authorization to **Read Only**.

**Self-hosted:**
- Default URL: `http://localhost:8080/SEMP/v2` or `https://localhost:943/SEMP/v2`
- Create a read-only user:
  ```
  solace(configure)# create management-user readonly-user password <pw>
  solace(configure)# management-user readonly-user authorization read-only
  ```

**Verify:**
```bash
curl -u USER:PASS "https://your-broker:943/SEMP/v2/monitor/msgVpns/default" | jq .data.msgVpnName
```

### Event Portal Token (optional)

1. [console.solace.cloud](https://console.solace.cloud) -> profile icon -> **Token Management**
2. **Generate Token** -> enable **Event Portal Read** permission
3. Copy immediately (shown once)

**Verify:**
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  "https://api.solace.cloud/api/v2/architecture/applicationDomains" | jq '.data | length'
```

If you skip this, the server starts without Event Portal tools and logs a clear message.

---

## Configuration Reference

| Variable | Required | Default | Description |
|---|---|---|---|
| `TRANSPORT` | No | `stdio` | `stdio` or `http` |
| `SEMP_BASE_URL` | Yes | -- | Broker SEMP v2 URL (e.g. `https://host:943/SEMP/v2`) |
| `SEMP_USERNAME` | Yes | -- | SEMP management username |
| `SEMP_PASSWORD` | Yes | -- | SEMP management password |
| `SOLACE_VPN` | Yes | -- | Default message VPN name |
| `SOLACE_CLOUD_TOKEN` | No | -- | Event Portal API token (omit to disable EP tools) |
| `HTTP_PORT` | No | `3000` | HTTP listen port (http mode only) |
| `HTTP_HOST` | No | `127.0.0.1` | HTTP bind address (http mode only) |
| `MCP_API_KEY` | http mode | -- | Bearer token for HTTP auth (min 32 chars) |
| `ALLOWED_ORIGINS` | No | -- | Comma-separated CORS origins (supports wildcards) |

Generate `MCP_API_KEY`:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## Security

### stdio mode
No network exposure. Communication is over stdin/stdout within the Claude process. No auth layer to misconfigure.

### HTTP mode
- **Per-request Bearer token** on every POST/GET/DELETE to `/mcp`
- **Origin validation** against `ALLOWED_ORIGINS` (DNS rebinding protection)
- **Rate limiting** — 60 req/IP per 15 min via `express-rate-limit`
- **Security headers** — `helmet` (X-Frame-Options, HSTS, CSP, etc.)
- **Session TTL** — idle sessions are cleaned up after 30 minutes
- **No credential logging** — Authorization headers are stripped by axios interceptors
- **Sanitized errors** — no stack traces or internal paths in tool responses
- **localhost only by default** — bind to `0.0.0.0` only behind a TLS reverse proxy

### Read-only by design
This server only calls `GET` endpoints. No queues are created, modified, or deleted. No messages are published. The SEMP user should be `read-only` to enforce this at the broker level too.

---

## Development

```bash
npm run dev          # stdio mode
npm run dev:http     # HTTP mode
```

**Test with the MCP inspector:**
```bash
npx @modelcontextprotocol/inspector http://localhost:3000/mcp
```

---

## Config File Locations

| OS | Path |
|---|---|
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` |
| Linux | `~/.config/Claude/claude_desktop_config.json` |

---

## Troubleshooting

| Error | Cause | Fix |
|---|---|---|
| `SEMP_BASE_URL is not set` | Env vars not passed to the process | Pass via `env` block in Claude config JSON |
| SEMP 401 | Wrong username/password | Use **Management** credentials (not messaging) |
| SEMP 403 | User lacks read permission | Set authorization to `read-only` |
| EP 401 | Token expired or incomplete | Regenerate in Token Management |
| EP 403 | Missing Event Portal Read scope | Regenerate with that scope enabled |
| `MCP_API_KEY must be at least 32 characters` | Key too short or missing | Generate with `crypto.randomBytes(32)` command |
| No tools in Claude Desktop | Config not reloaded | Restart Claude Desktop; validate JSON syntax |
| `ERR_MODULE_NOT_FOUND` | Not built | Run `npm run build` |
| HTTP 429 | Rate limit hit | Wait 15 min or increase `max` in rate limiter config |
| CORS rejection | Origin not in allowlist | Add to `ALLOWED_ORIGINS` |
| `Event Portal: skipped` at startup | `SOLACE_CLOUD_TOKEN` not set | Expected if you only need broker tools |
