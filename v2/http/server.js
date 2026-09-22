import { createMcpHandler } from "@modelcontextprotocol/server";
import { createMcpExpressApp } from "@modelcontextprotocol/express";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { createServer } from "@talk/mcp-shared";

const PORT = Number(process.env.PORT ?? 3000);

/**
 * MCP over Streamable HTTP.
 *
 * Same `createServer` factory as the stdio example — tools are
 * transport-agnostic.
 *
 * `createMcpHandler` turns the factory into a web-standard handler. Since the
 * 2026-07-28 spec MCP is stateless: no `initialize` handshake, no session id,
 * every request carries its own protocol version, so any instance behind a
 * plain round-robin load balancer can answer. 2025-era clients are still
 * served, statelessly, from the very same factory.
 */
const handler = createMcpHandler(createServer);
const node = toNodeHandler(handler);

// `createMcpExpressApp` is a plain Express app with the MCP defaults already
// in place: the JSON body parser, plus Host/Origin validation (DNS rebinding
// protection) when bound to localhost.
const app = createMcpExpressApp();

app.all("/mcp", (req, res) => node(req, res, req.body));

app.listen(PORT, () => {
  console.log(`MCP HTTP server is running on http://localhost:${PORT}/mcp`);
});
