# talk-mcp-silent-colleague — Code Examples

Code examples for the talk **"MCP: il collega silenzioso"**.

Two minimal MCP servers that expose a single `greet` tool, implemented with the two main transport strategies.

---

## Project structure

```
.
├── stdio/        # MCP server over stdio (for local/CLI integrations)
│   └── server.js
└── http/         # MCP server over Streamable HTTP (for remote integrations)
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

## The `greet` tool

Both servers expose the same tool:

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
| `express` _(http only)_ | HTTP server |
