import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { betterAuth } from "better-auth";
import { jwt } from "better-auth/plugins";
import { toNodeHandler } from "better-auth/node";
import { memoryAdapter } from "better-auth/adapters/memory";
import {
  oauthProvider,
  oauthProviderAuthServerMetadata,
} from "@better-auth/oauth-provider";
import { verifyAccessToken } from "better-auth/oauth2";
import express from "express";

const BASE_URL = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";

// ← slide "Becoming an OAuth provider"
const auth = betterAuth({
  baseURL: BASE_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  database: memoryAdapter({}),
  disabledPaths: ["/token"],
  plugins: [
    jwt({ disableSettingJwtHeader: true }),
    oauthProvider({
      loginPage: "/sign-in",
      consentPage: "/consent",
      allowDynamicClientRegistration: true,
      allowUnauthenticatedClientRegistration: true,
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

// ← slide "Protecting the endpoint"
const app = express();
app.all("/api/auth/{*path}", toNodeHandler(auth));
app.use(express.json());

const wellKnownHandler = oauthProviderAuthServerMetadata(auth);
app.get("/.well-known/oauth-authorization-server", async (req, res) => {
  const webReq = new Request(new URL(req.url, BASE_URL).href);
  const webRes = await wellKnownHandler(webReq);
  webRes.headers.forEach((v, k) => res.set(k, v));
  res.status(webRes.status).json(await webRes.json());
});
app.get("/.well-known/oauth-protected-resource", (_, res) => {
  res.json({
    resource: BASE_URL,
    authorization_servers: [BASE_URL],
    bearer_methods_supported: ["header"],
  });
});
app.get("/sign-in", (req, res) => {
  const oauthQuery = req.query.oauth_query ?? "";
  res.send(`<!doctype html><h1>Sign in</h1><button onclick="s()">GitHub</button>
    <script>async function s(){const r=await fetch("/api/auth/sign-in/social",{method:"POST",
    headers:{"Content-Type":"application/json"},body:JSON.stringify({provider:"github",
    callbackURL:"/api/auth/oauth2/authorize?oauth_query=${oauthQuery}"})});
    const{url}=await r.json();window.location.href=url}</script>`);
});
app.get("/consent", (req, res) => {
  const { client_id, scope, oauth_query = "" } = req.query;
  res.send(`<!doctype html><h1>Authorize ${client_id}?</h1><p>${scope}</p>
    <button onclick="d(true)">Allow</button><button onclick="d(false)">Deny</button>
    <script>async function d(accept){const r=await fetch("/api/auth/oauth2/consent",
    {method:"POST",credentials:"include",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({accept,oauth_query:"${oauth_query}"})});
    const data=await r.json();if(data.redirectURI)window.location.href=data.redirectURI}</script>`);
});

// ← slide "Protecting the endpoint"
app.post("/mcp", async (req, res) => {
  const accessToken = req.headers.authorization?.slice(7);

  try {
    await verifyAccessToken(accessToken, {
      verifyOptions: { issuer: BASE_URL, audience: BASE_URL },
    });
  } catch {
    res.set(
      "WWW-Authenticate",
      `Bearer resource_metadata="${BASE_URL}/.well-known/oauth-protected-resource"`,
    );
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
console.log(`MCP HTTP OAuth2 server running on ${BASE_URL}/mcp`);
