import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { betterAuth } from "better-auth";
import { bearer, jwt } from "better-auth/plugins";
import { toNodeHandler } from "better-auth/node";
import { memoryAdapter } from "better-auth/adapters/memory";
import {
  oauthProvider,
  oauthProviderAuthServerMetadata,
} from "@better-auth/oauth-provider";
import express from "express";

const BASE_URL = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";

const auth = betterAuth({
  baseURL: BASE_URL,
  secret: process.env.BETTER_AUTH_SECRET ?? "dev-secret-change-in-production",
  database: memoryAdapter({}),
  plugins: [
    jwt(),
    bearer(),
    oauthProvider({
      loginPage: `${BASE_URL}/api/auth/sign-in/social?provider=github`,
    }),
  ],
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
app.use("/api/auth", toNodeHandler(auth));
app.use(express.json());

const wellKnownHandler = oauthProviderAuthServerMetadata(auth);
app.get("/.well-known/oauth-authorization-server", async (req, res) => {
  const webReq = new Request(new URL(req.url, BASE_URL).href);
  const webRes = await wellKnownHandler(webReq);
  webRes.headers.forEach((v, k) => res.set(k, v));
  res.status(webRes.status).json(await webRes.json());
});

app.post("/mcp", async (req, res) => {
  const session = await auth.api.getSession({ headers: req.headers });

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
