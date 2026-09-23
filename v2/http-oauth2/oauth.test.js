import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import { makeSignature } from "better-auth/crypto";
import { createAuthorizationServer } from "./auth-server.js";
import { createResourceServer } from "./server.js";

async function listener(t) {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections();
  }));
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}

function pageScript(html, fetchPage) {
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 1, "exactly one trusted script");
  const error = { textContent: "" };
  const window = { location: { href: "" } };
  const context = { window, fetch: fetchPage, document: { getElementById: () => error } };
  runInNewContext(scripts[0][1], context);
  return { context, window, error };
}

test("OAuth flow with a local session and real provider/token verification", { timeout: 20000 }, async (t) => {
  const previous = process.env.MCP_DANGEROUSLY_ALLOW_INSECURE_ISSUER_URL;
  process.env.MCP_DANGEROUSLY_ALLOW_INSECURE_ISSUER_URL = "1";
  t.after(() => {
    if (previous === undefined) delete process.env.MCP_DANGEROUSLY_ALLOW_INSECURE_ISSUER_URL;
    else process.env.MCP_DANGEROUSLY_ALLOW_INSECURE_ISSUER_URL = previous;
  });
  const as = await listener(t);
  const rs = await listener(t);
  const mcpUrl = `${rs.url}/mcp`;
  const { app, auth } = createAuthorizationServer({
    authUrl: as.url, mcpUrl,
    secret: "local-test-secret-with-sufficient-entropy-123456789",
    githubClientId: "test-client", githubClientSecret: "test-secret",
  });
  as.server.on("request", app);
  const resource = await createResourceServer({ authUrl: as.url, mcpUrl });
  rs.server.on("request", resource.app);
  let cookie = "";
  const request = (path, options = {}) => fetch(new URL(path, as.url), {
    ...options, redirect: "manual", signal: AbortSignal.timeout(5000),
    headers: { accept: "application/json", origin: as.url, cookie, ...options.headers },
  });
  const post = (path, body) => request(path, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  async function redirect(response) {
    if (response.status === 302) return new URL(response.headers.get("location"), as.url);
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(body.redirect, true);
    return new URL(body.url, as.url);
  }

  await t.test("discovery and missing bearer challenge", async () => {
    const metadata = await (await request("/.well-known/oauth-authorization-server/api/auth")).json();
    assert.equal(metadata.issuer, `${as.url}/api/auth`);
    const protectedMetadata = await (await fetch(`${rs.url}/.well-known/oauth-protected-resource/mcp`)).json();
    assert.deepEqual(protectedMetadata.authorization_servers, [metadata.issuer]);
    const response = await fetch(mcpUrl, { method: "POST" });
    assert.equal(response.status, 401);
    assert.match(response.headers.get("www-authenticate"), /resource_metadata=/);
  });

  const registration = await post("/api/auth/oauth2/register", {
    client_name: "Local test", application_type: "native",
    redirect_uris: ["http://127.0.0.1:49199/callback"],
    grant_types: ["authorization_code"], response_types: ["code"],
    token_endpoint_auth_method: "none", scope: "mcp:tools",
  });
  assert.equal(registration.status, 201);
  const client = await registration.json();
  const verifier = randomBytes(32).toString("base64url");
  const query = new URLSearchParams({
    client_id: client.client_id, redirect_uri: client.redirect_uris[0],
    response_type: "code", scope: "mcp:tools", resource: mcpUrl,
    state: "test-state", code_challenge_method: "S256",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
  });
  const authorize = () => request(`/api/auth/oauth2/authorize?${query}`);
  let login;
  await t.test("DCR client is linked to the resource and reaches login", async () => {
    login = await redirect(await authorize());
    assert.equal(login.pathname, "/sign-in");
    assert.equal(login.searchParams.get("resource"), mcpUrl);
    assert.ok(login.searchParams.has("sig"));
  });
  await t.test("login forwards signed repeated parameters; no GitHub network request", async () => {
    const html = await (await request(login)).text();
    const page = pageScript(html, async (path, options) => {
      assert.equal(path, "/api/auth/sign-in/social");
      const body = JSON.parse(options.body);
      assert.equal(body.oauth_query, login.search.slice(1));
      assert.equal(new URL(body.callbackURL, as.url).searchParams.get("client_id"), client.client_id);
      return request(path, options);
    });
    await page.context.signIn();
    assert.equal(page.error.textContent, "");
    assert.equal(new URL(page.window.location.href).hostname, "github.com");
  });

  // Only authentication is simulated: the real adapter creates and signs a session.
  const context = await auth.$context;
  const user = await context.internalAdapter.createUser({
    name: "Local test", email: "test@example.com", emailVerified: true,
  });
  const session = await context.internalAdapter.createSession(user.id, false);
  cookie = `${context.authCookies.sessionToken.name}=${session.token}.${await makeSignature(session.token, context.secret)}`;

  async function consent(accept) {
    query.set("prompt", "consent");
    const target = await redirect(await authorize());
    assert.equal(target.pathname, "/consent");
    const html = await (await request(target)).text();
    const page = pageScript(html, request);
    await page.context.decide(accept);
    assert.equal(page.error.textContent, "");
    return new URL(page.window.location.href);
  }
  let code;
  await t.test("accepting consent returns a code to the client", async () => {
    const target = await consent(true);
    assert.equal(target.origin + target.pathname, client.redirect_uris[0]);
    assert.equal(target.searchParams.get("state"), "test-state");
    code = target.searchParams.get("code");
    assert.ok(code);
  });
  await t.test("denying consent returns access_denied", async () => {
    const target = await consent(false);
    assert.equal(target.searchParams.get("error"), "access_denied");
    assert.equal(target.searchParams.get("state"), "test-state");
    assert.equal(target.searchParams.has("code"), false);
  });
  async function exchange(code, codeVerifier = verifier) {
    return request("/api/auth/oauth2/token", {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", client_id: client.client_id,
        redirect_uri: client.redirect_uris[0], resource: mcpUrl, code, code_verifier: codeVerifier }),
    });
  }
  const callTool = (token) => fetch(mcpUrl, {
    method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream",
      authorization: `Bearer ${token}`, "Mcp-Method": "tools/call", "Mcp-Name": "greet" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: {
      name: "greet", arguments: { name: "Local test" }, _meta: {
        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
        "io.modelcontextprotocol/clientCapabilities": {},
      },
    } }),
  });
  await t.test("PKCE exchange issues a JWT accepted by the MCP resource server", async () => {
    const response = await exchange(code);
    const tokens = await response.json();
    assert.equal(response.status, 200, JSON.stringify(tokens));
    assert.ok(tokens.access_token);
    const result = await callTool(tokens.access_token);
    const body = await result.json();
    assert.equal(result.status, 200, JSON.stringify(body));
    assert.equal(body.result.content[0].text, "Hello, Local test!");
    assert.equal((await callTool(`${tokens.access_token}tampered`)).status, 401);
    assert.equal((await exchange(code)).status, 400, "codes cannot be reused");
  });
  await t.test("incorrect PKCE verifier is rejected", async () => {
    const target = await consent(true);
    const response = await exchange(target.searchParams.get("code"), "x".repeat(43));
    const body = await response.json();
    // better-auth answers 401 here, not the 400 invalid_grant of RFC 6749.
    assert.equal(response.status, 401, JSON.stringify(body));
    assert.equal(body.error_description, "code verification failed");
    assert.equal(body.access_token, undefined);
  });
  await t.test("unsigned or tampered consent is rejected", async () => {
    const target = await redirect(await authorize());
    target.searchParams.set("scope", "openid");
    const response = await post("/api/auth/oauth2/consent", { accept: true, oauth_query: target.search.slice(1) });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, "invalid_signature");
  });
  await t.test("untrusted consent fields cannot inject HTML or scripts", async () => {
    const payload = '</script><script>throw new Error("injected")</script>';
    const params = new URLSearchParams({ client_id: payload, scope: payload, sig: payload });
    params.append("ba_param", "client_id");
    const html = await (await request(`/consent?${params}`)).text();
    assert.equal(html.includes(payload), false);
    assert.ok(html.includes("&lt;/script&gt;"));
    pageScript(html, request);
  });
});
