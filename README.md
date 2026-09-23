# talk-mcp-silent-colleague — Code Examples

Code examples for the talk **"MCP: il collega silenzioso"**.

Two generations of the same examples, side by side:

| Folder | Spec | SDK |
|---|---|---|
| [`v2/`](./v2) | **2026-07-28** — stateless, OAuth 2.1 resource server, WebMCP | `@modelcontextprotocol/server@2` |
| `stdio/`, `http/`, `http-oauth2/`, `webmcp/` | 2025 era | `@modelcontextprotocol/sdk@1` |

**Start with [`v2/`](./v2)** — it is what the current version of the talk shows on screen. The folders below are kept as-is, as a reference for what the same code looked like before the v2 SDK.

---

## v1 (SDK v1)

Three minimal MCP servers that expose a single `greet` tool, covering stdio, HTTP, and HTTP with OAuth2 authentication.

---

## Project structure

```
.
├── stdio/        # MCP server over stdio (for local/CLI integrations)
│   └── server.js
├── http/         # MCP server over Streamable HTTP (stateless, no auth)
│   └── server.js
└── http-oauth2/  # MCP server over Streamable HTTP with OAuth2 via Better Auth
    └── server.js
```

---

## stdio

Communicates over standard input/output. The host process spawns the server and speaks MCP directly over stdin/stdout.

### Install & run

```bash
cd stdio
pnpm install
pnpm start
```

### How it works

- Creates an `McpServer` instance and registers the `greet` tool.
- Connects a `StdioServerTransport` — the server stays alive reading from stdin.

---

## http

Exposes an MCP endpoint over HTTP using the Streamable HTTP transport. A new server instance is created per request (stateless).

### Install & run

```bash
cd http
pnpm install
pnpm start
```

The server listens on `http://localhost:3000/mcp`.

### How it works

- Each `POST /mcp` request creates a fresh `McpServer` + `StreamableHTTPServerTransport` pair.
- This avoids the "Already connected to a transport" error that occurs when a single server instance is reused across multiple connections.

---

## http-oauth2

Same as `http`, but the server also acts as a full **OAuth2 authorization server** powered by [Better Auth](https://better-auth.com/) and the [`@better-auth/oauth-provider`](https://www.better-auth.com/docs/plugins/oauth-provider) plugin. GitHub is used as the social login provider behind it. MCP clients obtain a token via the standard OAuth2 flow and pass it as `Authorization: Bearer <token>`.

### Install & run

```bash
cd http-oauth2
pnpm install
BETTER_AUTH_URL=http://localhost:3000 \
BETTER_AUTH_SECRET=<random-secret> \
GITHUB_ID=<your-github-client-id> \
GITHUB_SECRET=<your-github-client-secret> \
pnpm start
```

The server listens on `http://localhost:3000/mcp`.

### Endpoints

| Path | Description |
|---|---|
| `/.well-known/oauth-authorization-server` | OAuth2 authorization server metadata (RFC 8414) |
| `/api/auth/*` | Better Auth routes (sign-in, token exchange, …) |
| `POST /mcp` | MCP endpoint — requires a valid Bearer token |

### How it works

- `betterAuth` is initialized with the `jwt()`, `bearer()`, and `oauthProvider()` plugins and an in-memory adapter.
- `oauthProvider()` exposes `/.well-known/oauth-authorization-server` so MCP clients can auto-discover the authorization server.
- The login page redirects users through GitHub OAuth via the `socialProviders.github` configuration.
- On each `POST /mcp` request, `auth.api.getSession()` validates the Bearer token against the session store.
- If no valid session is found, the request is rejected with `401` before any MCP processing occurs.
- If authenticated, a fresh `McpServer` + `StreamableHTTPServerTransport` pair handles the request.

### Environment variables

| Variable | Description |
|---|---|
| `BETTER_AUTH_URL` | Base URL of this server (default: `http://localhost:3000`) |
| `BETTER_AUTH_SECRET` | Secret used to sign tokens (default: `dev-secret-change-in-production`) |
| `GITHUB_ID` | GitHub OAuth App client ID |
| `GITHUB_SECRET` | GitHub OAuth App client secret |

---

## The `greet` tool

All three servers expose the same tool:

| Field | Value |
|---|---|
| Name | `greet` |
| Description | Returns a greeting for the given name |
| Input | `name` (string) |
| Output | `Hello, <name>!` |

---

## Dependencies

| Package | Purpose |
|---|---|
| `@modelcontextprotocol/sdk` | MCP server SDK |
| `zod` | Input schema validation |
| `express` _(http, http-oauth2)_ | HTTP server |
| `better-auth` _(http-oauth2 only)_ | OAuth2 / session authentication |
| `@better-auth/oauth-provider` _(http-oauth2 only)_ | OAuth2 authorization server plugin for Better Auth |
