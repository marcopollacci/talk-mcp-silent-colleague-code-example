import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
  name: "my-mcp-server",
  version: "1.0.0",
});

server.tool(
  "greet",
  "Returns a greeting for the given name",
  { name: z.string() },
  async ({ name }) => ({
    content: [{ type: "text", text: `Hello, ${name}!` }],
  }),
);

const transport = new StdioServerTransport();
await server.connect(transport);
