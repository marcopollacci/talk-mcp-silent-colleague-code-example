import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { betterAuth } from "better-auth";
import { bearer } from "better-auth/plugins";
import express from "express";

const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  plugins: [bearer()],
  socialProviders: {
    github: {
      clientId: process.env.GITHUB_ID,
      clientSecret: process.env.GITHUB_SECRET,
    },
  },
});

const createServer = () => {
  const server = new McpServer({
    name: "my-mcp-http-oauth2-server",
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

  return server;
};

const app = express();
app.use(express.json());

app.post("/mcp", async (req, res) => {
  const session = await auth.api.getSession({
    headers: req.headers,
  });

  if (!session?.user) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  const server = createServer();
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

app.listen(3000);
console.log("MCP HTTP OAuth2 server is running on http://localhost:3000/mcp");
