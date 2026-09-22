import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

/**
 * The server capabilities shown in the talk, in one place.
 *
 * Tools, resources and prompts are transport-agnostic: the exact same factory
 * is served over stdio, over Streamable HTTP, and over HTTP behind OAuth 2.1.
 * Only the entry point differs.
 */

// A tiny fake back office, so every capability tells the same story.
const ORDERS = [
  { id: 1, customerId: "123", item: "Mechanical keyboard", status: "pending" },
  { id: 2, customerId: "123", item: "USB-C dock", status: "pending" },
  { id: 3, customerId: "456", item: "27\" monitor", status: "pending" },
];

const pendingOrdersFor = (customerId) =>
  ORDERS.filter((order) => order.customerId === customerId);

const formatOrder = (order) => `Order #${order.id} — ${order.item}`;

export function createServer() {
  const server = new McpServer({
    name: "my-mcp-server",
    version: "1.0.0",
  });

  // 🧰 Tools — functions the AI can invoke.
  server.registerTool(
    "greet",
    {
      description: "Returns a greeting for the given name",
      inputSchema: z.object({ name: z.string() }),
    },
    async ({ name }) => ({
      content: [{ type: "text", text: `Hello, ${name}!` }],
    }),
  );

  server.registerTool(
    "getOrders",
    {
      description: "Returns pending orders for a customer",
      inputSchema: z.object({ customerId: z.string() }),
    },
    async ({ customerId }) => {
      const orders = pendingOrdersFor(customerId);

      return {
        content: [
          { type: "text", text: `Found ${orders.length} pending orders.` },
          ...orders.map((order) => ({
            type: "text",
            text: formatOrder(order),
          })),
        ],
      };
    },
  );

  // 📦 Resources — read-only data, addressed by URI.
  //
  // `cacheHint` is what puts `ttlMs` / `cacheScope` in the response: since the
  // 2026-07-28 spec, list and read results are cacheable, so the client knows
  // how long the answer stays fresh and who may cache it.
  server.registerResource(
    "pending-orders",
    "orders://pending",
    {
      description: "Returns the list of pending orders",
      mimeType: "text/plain",
      cacheHint: { ttlMs: 60_000, cacheScope: "private" },
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "text/plain",
          text: ORDERS.map(formatOrder).join("\n"),
        },
      ],
    }),
  );

  // 💬 Prompts — message templates the client can inject in the conversation.
  server.registerPrompt(
    "customer-support",
    {
      description: "Generates a support context for a customer",
      argsSchema: z.object({ customerId: z.string() }),
    },
    async ({ customerId }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Customer ${customerId} needs help. Use the available customer/order tools if needed, then suggest next steps.`,
          },
        },
      ],
    }),
  );

  return server;
}
