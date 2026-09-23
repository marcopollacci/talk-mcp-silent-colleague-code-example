import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import express from "express";
import { betterAuth } from "better-auth";
import { jwt } from "better-auth/plugins";
import { toNodeHandler } from "better-auth/node";
import { memoryAdapter } from "better-auth/adapters/memory";
import {
  DEFAULT_OAUTH_SCOPES,
  oauthProvider,
  oauthProviderAuthServerMetadata,
} from "@better-auth/oauth-provider";

/**
 * The AUTHORIZATION SERVER.
 *
 * It runs in its own process, on its own port, on purpose: in MCP the
 * authorization server and the MCP server are two different roles. This one
 * owns login, consent and token issuance. It knows nothing about MCP.
 *
 * In production this is your identity provider — Keycloak, Auth0, Clerk,
 * better-auth, whatever you already run. Here it is better-auth with GitHub
 * behind it, so the demo is self-contained.
 */

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[character]);

// An embedded JSON string must not be able to close its script tag.
const scriptValue = (value) => JSON.stringify(value).replace(/</g, "\\u003c");

function signedQuery(req, baseUrl) {
  const params = new URL(req.originalUrl, baseUrl).searchParams;
  const names = new Set([...params.getAll("ba_param"), "ba_param", "sig"]);
  return new URLSearchParams([...params].filter(([name]) => names.has(name))).toString();
}

export function createAuthorizationServer({
  authUrl = process.env.AUTH_URL ?? "http://localhost:3001",
  mcpUrl = process.env.MCP_URL ?? "http://localhost:3000/mcp",
  secret = process.env.BETTER_AUTH_SECRET,
  githubClientId = process.env.GITHUB_ID,
  githubClientSecret = process.env.GITHUB_SECRET,
} = {}) {
  /**
   * In-memory store: everything is gone on restart. Good enough for a talk.
   * The adapter reads tables it is given, so every model used by better-auth
   * core, the jwt plugin and the oauth provider starts as an empty array.
   */
  const memoryDb = {
    user: [],
    session: [],
    account: [],
    verification: [],
    jwks: [],
    oauthClient: [],
    oauthResource: [],
    oauthClientResource: [],
    oauthRefreshToken: [],
    oauthAccessToken: [],
    oauthConsent: [],
    oauthClientAssertion: [],
  };

  const auth = betterAuth({
    baseURL: authUrl,
    secret,
    database: memoryAdapter(memoryDb),
    // The jwt plugin's own /token endpoint is not OAuth: turn it off, so the
    // only way to get a token is /oauth2/token.
    disabledPaths: ["/token"],
    plugins: [
      // Signs access tokens as JWTs and publishes the JWKS the MCP server
      // validates them against, at /api/auth/jwks.
      jwt({ disableSettingJwtHeader: true }),
      oauthProvider({
        loginPage: "/sign-in",
        consentPage: "/consent",
        scopes: [...DEFAULT_OAUTH_SCOPES, "mcp:tools"],
        // RFC 8707 resource indicator: the MCP server is a protected resource
        // this AS issues tokens for. A token asked for with
        // `resource=<MCP_URL>` comes back as a JWT with that `aud`, which is
        // exactly what binds the token to this MCP server and nothing else.
        resources: [
          {
            identifier: mcpUrl,
            name: "MCP server",
            allowedScopes: ["mcp:tools"],
          },
        ],
        // Link dynamically registered clients to this demo's resource.
        clientRegistrationDefaultResources: [mcpUrl],
        // Client ID Metadata Documents (CIMD) are the preferred way to identify
        // clients in the 2026-07-28 spec — see the @better-auth/cimd plugin.
        // Dynamic Client Registration is deprecated and kept as a fallback, but
        // it is still what most clients (MCP Inspector included) use today.
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,
      }),
    ],
    socialProviders: {
      github: {
        clientId: githubClientId,
        clientSecret: githubClientSecret,
      },
    },
  });

  const app = express();

  app.all("/api/auth/{*path}", toNodeHandler(auth));

  /**
   * Authorization Server Metadata (RFC 8414).
   *
   * Step 2 of the discovery chain: the client landed here because the MCP
   * server's protected resource metadata pointed at this origin. This document
   * tells it where to send the user, where to exchange the code, and that PKCE
   * S256 is supported.
   */
  const authServerMetadataHandler = oauthProviderAuthServerMetadata(auth);

  app.get([
    "/.well-known/oauth-authorization-server",
    "/.well-known/oauth-authorization-server/api/auth",
  ], async (req, res) => {
    const webReq = new Request(new URL(req.url, authUrl).href);
    const webRes = await authServerMetadataHandler(webReq);

    webRes.headers.forEach((value, key) => res.set(key, value));
    res.status(webRes.status).json(await webRes.json());
  });

  /** Step 5a — the login page. Deliberately ugly: it is not the point. */
  app.get("/sign-in", (req, res) => {
    const oauthQuery = signedQuery(req, authUrl);
    res.set("Cache-Control", "no-store");

    res.send(`<!doctype html>
      <meta charset="utf-8" />
      <h1>Sign in</h1>
      <button onclick="signIn()">Continue with GitHub</button>
      <p id="error" role="alert"></p>

      <script>
        async function signIn() {
          try {
            const response = await fetch("/api/auth/sign-in/social", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                provider: "github",
                oauth_query: ${scriptValue(oauthQuery)},
                callbackURL: ${scriptValue(`/api/auth/oauth2/authorize?${oauthQuery}`)}
              })
            });

            const data = await response.json();
            if (!response.ok || !data.url) throw new Error(data.message ?? "Sign-in failed");
            window.location.href = data.url;
          } catch (error) {
            document.getElementById("error").textContent = error.message;
          }
        }
      </script>
    `);
  });

  /** Step 5b — consent: which client is asking, for which scopes. */
  app.get("/consent", (req, res) => {
    const clientId = String(req.query.client_id ?? "");
    const scope = String(req.query.scope ?? "");
    const oauthQuery = signedQuery(req, authUrl);
    res.set("Cache-Control", "no-store");

    res.send(`<!doctype html>
      <meta charset="utf-8" />
      <h1>Authorize ${escapeHtml(clientId)}?</h1>
      <p>Requested scopes: <code>${escapeHtml(scope)}</code></p>

      <button onclick="decide(true)">Allow</button>
      <button onclick="decide(false)">Deny</button>
      <p id="error" role="alert"></p>

      <script>
        async function decide(accept) {
          try {
            const response = await fetch("/api/auth/oauth2/consent", {
              method: "POST",
              credentials: "include",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                accept,
                oauth_query: ${scriptValue(oauthQuery)}
              })
            });

            const data = await response.json();
            if (!response.ok || !data.url) throw new Error(data.error_description ?? data.message ?? "Consent failed");
            window.location.href = data.url;
          } catch (error) {
            document.getElementById("error").textContent = error.message;
          }
        }
      </script>
    `);
  });

  return { app, auth, authUrl, mcpUrl };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { app, authUrl, mcpUrl } = createAuthorizationServer();

  app.listen(Number(new URL(authUrl).port || 3001), () => {
    console.log(`OAuth authorization server running on ${authUrl}`);
    console.log(`  metadata: ${authUrl}/.well-known/oauth-authorization-server`);
    console.log(`  jwks:     ${authUrl}/api/auth/jwks`);
    console.log(`  issuing tokens for resource: ${mcpUrl}`);
  });
}
