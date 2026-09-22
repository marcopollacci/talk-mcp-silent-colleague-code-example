# v2 — MCP 2026-07-28 / TypeScript SDK v2

The code from the **"MCP: il collega silenzioso"** slides, expanded until it actually runs.

Everything here targets the [2026-07-28 spec](https://modelcontextprotocol.io/specification/2026-07-28) and the **v2** TypeScript SDK, which replaced the monolithic `@modelcontextprotocol/sdk` package with `@modelcontextprotocol/server` plus framework adapters.

The v1 examples are still in the repository root (`../stdio`, `../http`, `../http-oauth2`, `../webmcp`), untouched, if you want to compare.

---

## Setup

```bash
cd v2
pnpm install
```

One install covers every example: `v2` is a pnpm workspace and the four projects share `shared/`.

---

## Project structure

```
v2/
├── shared/        # createServer() — the tools, resources and prompts from the slides
├── stdio/         # MCP over stdio
├── http/          # MCP over Streamable HTTP (stateless)
├── http-oauth2/   # the same, behind OAuth 2.1 (authorization server + resource server)
└── webmcp/        # WebMCP in the browser
```

`shared/mcp-server.js` is the point: **tools are transport-agnostic**. The exact same factory is served over stdio, over HTTP, and over HTTP behind OAuth. Only the entry point changes.

It registers all three server capabilities:

| Capability | Name | What it does |
|---|---|---|
| 🧰 Tool | `greet` | `Hello, <name>!` |
| 🧰 Tool | `getOrders` | pending orders for a customer |
| 📦 Resource | `orders://pending` | the list of pending orders |
| 💬 Prompt | `customer-support` | a support context for a customer |

---

## stdio

```bash
pnpm start:stdio
# or: npx @modelcontextprotocol/inspector node stdio/server.js
```

`serveStdio(createServer)` takes the *factory*, not a server instance: it owns the connection and pins one instance to it. stdout is the protocol channel — logs go to stderr.

Point a client at it with `stdio/mcp.json`.

## http

```bash
pnpm start:http           # http://localhost:3000/mcp
```

`createMcpHandler(createServer)` + `toNodeHandler` + `createMcpExpressApp()`. Since 2026-07-28 MCP is **stateless**: no `initialize` handshake, no session id — every request carries its own protocol version, so the first request can already be `tools/list`.

Try it with the Inspector (`npx @modelcontextprotocol/inspector`, then paste the URL), or by hand:

```bash
curl -s http://localhost:3000/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -H 'Mcp-Method: tools/call' \
  -H 'Mcp-Name: greet' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{
        "name":"greet","arguments":{"name":"DevFest"},
        "_meta":{
          "io.modelcontextprotocol/protocolVersion":"2026-07-28",
          "io.modelcontextprotocol/clientCapabilities":{}
        }}}'
```

Two things the slides leave out because a real client sends them for you:

- `_meta` must carry **both** `protocolVersion` and `clientCapabilities` — the handshake is gone, so this is where that information lives now;
- over HTTP the request must repeat its routing in the `Mcp-Method` header (and `Mcp-Name` when the body names a tool, a resource URI or a prompt). Headers and body disagreeing is a `400`.

## http-oauth2

Two processes, because they are two roles:

```bash
cp .env.example .env     # fill in GITHUB_ID / GITHUB_SECRET / BETTER_AUTH_SECRET
pnpm start:auth          # http://localhost:3001 — authorization server (better-auth)
pnpm start:oauth2        # http://localhost:3000/mcp — MCP resource server
```

Start the authorization server first: the resource server reads its metadata at boot instead of hardcoding endpoints.

**The MCP server never issues tokens.** It verifies them. The only authorization code in `server.js` is the verifier — one function, `token → { clientId, scopes, expiresAt }` — plus two SDK helpers:

- `mcpAuthMetadataRouter(...)` publishes the sign on the door: Protected Resource Metadata at `/.well-known/oauth-protected-resource/mcp` (RFC 9728 path insertion, note how the `/mcp` path moves);
- `requireBearerAuth(...)` is the bouncer: no valid token → `401` with a `WWW-Authenticate` pointing at the sign, wrong scopes → `403`.

See the discovery chain for yourself:

```bash
curl -i -X POST http://localhost:3000/mcp -H 'Mcp-Method: tools/list' \
  -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
# → 401 WWW-Authenticate: Bearer ... resource_metadata="http://localhost:3000/.well-known/oauth-protected-resource/mcp"

curl -s http://localhost:3000/.well-known/oauth-protected-resource/mcp
# → { "resource": ..., "authorization_servers": ["http://localhost:3001/api/auth"], ... }

curl -s http://localhost:3001/.well-known/oauth-authorization-server
# → authorization_endpoint, token_endpoint, code_challenge_methods_supported: ["S256"], ...
```

For the full flow (login → consent → token → tool call), use the MCP Inspector against `http://localhost:3000/mcp`: it implements the client side, including PKCE, the `resource` parameter (RFC 8707) and dynamic client registration. You need a real GitHub OAuth App, with callback `http://localhost:3001/api/auth/callback/github`.

Client registration note: the 2026-07-28 spec prefers **Client ID Metadata Documents** (the `client_id` is an HTTPS URL pointing at a JSON document), and deprecates Dynamic Client Registration. DCR stays enabled here as the fallback, because it is what most clients still use. For CIMD, see the `@better-auth/cimd` plugin.

## webmcp

```bash
pnpm start:webmcp        # serves webmcp/ on http://localhost:3000
```

Open it in Chrome 149+ with `chrome://flags/#enable-webmcp-testing` (no origin-trial token needed for local testing). The page registers the same tool twice, once per mode:

- **imperative** — `document.modelContext.registerTool({ ..., execute })`, where `execute` runs in the browser with the app's own state;
- **declarative** — a `<form toolname="..." tooldescription="...">`; the form *is* the tool.

Older demos use `navigator.modelContext`: Chrome 150 deprecated that alias in favour of `document.modelContext`.

WebMCP is a W3C Community Group draft with no cross-browser consensus yet. Treat it as a preview.

---

## Testing with the MCP Inspector

```bash
# stdio server
npx @modelcontextprotocol/inspector node stdio/server.js

# remote / HTTP server
npx @modelcontextprotocol/inspector
# then paste your URL: http://localhost:3000/mcp

# scriptable, e.g. in CI
npx @modelcontextprotocol/inspector --cli node stdio/server.js -- --method tools/list
npx @modelcontextprotocol/inspector --cli node stdio/server.js -- \
  --method tools/call --tool-name greet --tool-arg name=DevFest
npx @modelcontextprotocol/inspector --cli node stdio/server.js -- \
  --method resources/read --uri "orders://pending"
npx @modelcontextprotocol/inspector --cli node stdio/server.js -- \
  --method prompts/get --prompt-name customer-support --prompt-args customerId=123
```

Inspector v2 shipped with the 2026-07-28 spec: web UI, a scriptable CLI and a terminal UI in one package. The server command comes first; Inspector flags go after the `--`.

---

## What changed since v1

| v1 | v2 |
|---|---|
| `@modelcontextprotocol/sdk` | `@modelcontextprotocol/server` + `/express` + `/node` |
| `server.tool(name, description, shape, cb)` | `server.registerTool(name, { description, inputSchema }, cb)` |
| `zod@3`, `import { z } from "zod"` | `zod@4`, `import * as z from "zod/v4"` |
| `new StdioServerTransport()` + `server.connect()` | `serveStdio(createServer)` |
| a transport per request, by hand | `createMcpHandler(createServer)` + `toNodeHandler` |
| `express()` + `express.json()` | `createMcpExpressApp()` (body parser + DNS-rebinding guards) |
| `initialize` handshake, session id | stateless: `_meta` on every request |
| MCP server acting as its own OAuth provider | authorization server and resource server split |
| `/.well-known/...` written by hand | `mcpAuthMetadataRouter` |
| 401 assembled by hand | `requireBearerAuth` |
| `navigator.modelContext` | `document.modelContext` |
