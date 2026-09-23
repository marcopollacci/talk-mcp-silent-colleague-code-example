import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  createMcpHandler,
  OAuthError,
  OAuthErrorCode,
} from "@modelcontextprotocol/server";
import {
  createMcpExpressApp,
  getOAuthProtectedResourceMetadataUrl,
  mcpAuthMetadataRouter,
  requireBearerAuth,
} from "@modelcontextprotocol/express";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { oauthProviderResourceClient } from "@better-auth/oauth-provider/resource-client";
import { createServer } from "@talk/mcp-shared";

/**
 * The MCP server as an OAuth RESOURCE SERVER.
 *
 * It verifies access tokens. It never issues them — that is the
 * authorization server's job, and it runs in the other process
 * (`auth-server.js`).
 *
 * Same `createServer` factory as the stdio and plain HTTP examples: the tools
 * do not change because the endpoint got an authorization layer.
 */

export async function createResourceServer({
  authUrl = process.env.AUTH_URL ?? "http://localhost:3001",
  mcpUrl = process.env.MCP_URL ?? "http://localhost:3000/mcp",
} = {}) {
  /**
   * Discovery, step 2, done once at boot: we read the authorization server's
   * metadata instead of hardcoding its endpoints, so the two processes never
   * drift apart.
   */
  async function fetchAuthorizationServerMetadata() {
    const url = `${authUrl}/.well-known/oauth-authorization-server`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(
        `Cannot reach the authorization server at ${url} (${response.status}). Start it with: pnpm start:auth`,
      );
    }

    return response.json();
  }

  const oauthMetadata = await fetchAuthorizationServerMetadata();

  /**
   * The verifier: the ONLY piece of authorization code we write.
   *
   *   token → { clientId, scopes, expiresAt }
   *
   * How you get there is your business — JWKS, RFC 7662 introspection, or a
   * call to your identity provider. Here we validate the JWT locally against
   * the JWKS the authorization server publishes, checking that the token was
   * issued by it (`issuer`) and minted for *this* MCP server (`audience`).
   */
  const resourceClient = oauthProviderResourceClient().getActions();

  const verifier = {
    async verifyAccessToken(token) {
      let payload;

      try {
        payload = await resourceClient.verifyBearerToken(token, {
          verifyOptions: {
            issuer: oauthMetadata.issuer,
            audience: mcpUrl,
          },
          // Published by the authorization server in its metadata.
          jwksUrl: oauthMetadata.jwks_uri,
        });
      } catch (error) {
        throw new OAuthError(
          OAuthErrorCode.InvalidToken,
          `Invalid or expired access token: ${error.message}`,
        );
      }

      const scopes =
        typeof payload.scope === "string"
          ? payload.scope.split(" ").filter(Boolean)
          : (payload.scopes ?? []);

      return {
        token,
        clientId: String(payload.client_id ?? payload.azp ?? ""),
        scopes,
        expiresAt: payload.exp,
        resource: new URL(mcpUrl),
      };
    },
  };

  const handler = createMcpHandler(createServer);
  const node = toNodeHandler(handler);

  const app = createMcpExpressApp();

  /**
   * The sign on the door: Protected Resource Metadata (RFC 9728).
   *
   * The router publishes it at /.well-known/oauth-protected-resource/mcp —
   * note the path insertion, it follows the /mcp path of `resourceServerUrl`.
   * It also mirrors the authorization server metadata at this origin, for
   * 2025-era clients that probe the resource origin first.
   */
  app.use(
    mcpAuthMetadataRouter({
      oauthMetadata,
      resourceServerUrl: new URL(mcpUrl),
      resourceName: "MCP demo server",
      scopesSupported: ["mcp:tools"],
    }),
  );

  /**
   * The bouncer. No valid token: 401, with a WWW-Authenticate header pointing
   * at the sign. Valid token but missing scopes: 403.
   */
  app.all(
    "/mcp",
    requireBearerAuth({
      verifier,
      requiredScopes: ["mcp:tools"],
      resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(new URL(mcpUrl)),
    }),
    (req, res) => node(req, res, req.body),
  );

  return { app, oauthMetadata, mcpUrl };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { app, oauthMetadata, mcpUrl } = await createResourceServer();

  app.listen(Number(new URL(mcpUrl).port || 3000), () => {
    console.log(`MCP resource server running on ${mcpUrl}`);
    console.log(
      `  protected resource metadata: ${getOAuthProtectedResourceMetadataUrl(new URL(mcpUrl))}`,
    );
    console.log(`  authorization server: ${oauthMetadata.issuer}`);
  });
}
