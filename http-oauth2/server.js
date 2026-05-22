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

const AUTH_BASE_URL = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";

const MCP_RESOURCE_URL = process.env.MCP_RESOURCE_URL ?? `${AUTH_BASE_URL}/mcp`;

const PROTECTED_RESOURCE_METADATA_URL = `${AUTH_BASE_URL}/.well-known/oauth-protected-resource`;

// ← slide "Becoming an OAuth provider"
const auth = betterAuth({
  baseURL: AUTH_BASE_URL,
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

const app = express();

app.all("/api/auth/{*path}", toNodeHandler(auth));
app.use(express.json());

/**
 * 2. Authorization Server Metadata
 *
 * This is the standard OAuth metadata document.
 * The MCP client reaches this after reading the protected resource metadata.
 */
const authServerMetadataHandler = oauthProviderAuthServerMetadata(auth);

app.get("/.well-known/oauth-authorization-server", async (req, res) => {
  const webReq = new Request(new URL(req.url, AUTH_BASE_URL).href);
  const webRes = await authServerMetadataHandler(webReq);

  webRes.headers.forEach((value, key) => {
    res.set(key, value);
  });

  res.status(webRes.status).json(await webRes.json());
});

/**
 * 1. Protected Resource Metadata
 *
 * This is the MCP-specific discovery document.
 * It tells the MCP client:
 * - which resource is protected
 * - which authorization server can issue tokens for it
 * - how bearer tokens are accepted
 */
app.get("/.well-known/oauth-protected-resource", (_, res) => {
  res.json({
    resource: MCP_RESOURCE_URL,
    authorization_servers: [AUTH_BASE_URL],
    bearer_methods_supported: ["header"],
    scopes_supported: ["mcp:tools"],
  });
});

app.get("/sign-in", (req, res) => {
  const oauthQuery = String(req.query.oauth_query ?? "");

  res.send(`<!doctype html>
    <h1>Sign in</h1>
    <button onclick="signIn()">GitHub</button>

    <script>
      async function signIn() {
        const response = await fetch("/api/auth/sign-in/social", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            provider: "github",
            callbackURL: "/api/auth/oauth2/authorize?oauth_query=${encodeURIComponent(oauthQuery)}"
          })
        });

        const { url } = await response.json();
        window.location.href = url;
      }
    </script>
  `);
});

app.get("/consent", (req, res) => {
  const clientId = String(req.query.client_id ?? "");
  const scope = String(req.query.scope ?? "");
  const oauthQuery = String(req.query.oauth_query ?? "");

  res.send(`<!doctype html>
    <h1>Authorize ${clientId}?</h1>
    <p>${scope}</p>

    <button onclick="decide(true)">Allow</button>
    <button onclick="decide(false)">Deny</button>

    <script>
      async function decide(accept) {
        const response = await fetch("/api/auth/oauth2/consent", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            accept,
            oauth_query: "${oauthQuery}"
          })
        });

        const data = await response.json();

        if (data.redirectURI) {
          window.location.href = data.redirectURI;
        }
      }
    </script>
  `);
});

// ← slide "Protecting the endpoint"
app.post("/mcp", async (req, res) => {
  const accessToken = req.headers.authorization?.replace(/^Bearer\s+/i, "");

  try {
    await verifyAccessToken(accessToken, {
      verifyOptions: {
        issuer: AUTH_BASE_URL,
        audience: MCP_RESOURCE_URL,
      },
    });
  } catch {
    res.set(
      "WWW-Authenticate",
      `Bearer resource_metadata="${PROTECTED_RESOURCE_METADATA_URL}"`,
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

console.log(`MCP HTTP OAuth2 server running on ${MCP_RESOURCE_URL}`);
console.log(`OAuth authorization server running on ${AUTH_BASE_URL}`);
