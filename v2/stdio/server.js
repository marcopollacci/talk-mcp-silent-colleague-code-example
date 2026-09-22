import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createServer } from "@talk/mcp-shared";

/**
 * MCP over stdio.
 *
 * `serveStdio` takes the *factory*, not a server instance: it owns the
 * connection, picks the protocol era from the opening exchange and pins one
 * instance from the factory for the lifetime of the connection.
 *
 * stdout is the protocol channel — anything you log must go to stderr.
 */
console.error("MCP stdio server ready");

serveStdio(createServer);
