import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
const token = process.env.EIDOS_TV_SESSION_TOKEN;
if (!token)
  throw Error("Set EIDOS_TV_SESSION_TOKEN to a session grant from the lab.");
const url = new URL(
  process.env.EIDOS_TV_MCP_URL ?? "http://127.0.0.1:4317/mcp",
);
if (!["127.0.0.1", "localhost"].includes(url.hostname))
  throw Error(
    "Only the local lab is supported; remote hosting requires an authenticated gateway.",
  );
const client = new Client({ name: "eidos-tv-stdio-proxy", version: "0.1.0" });
await client.connect(
  new StreamableHTTPClientTransport(url, {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  }),
);
const server = new Server(
  { name: "eidos-tv-lab", version: "0.1.0" },
  { capabilities: { tools: {} } },
);
server.setRequestHandler(ListToolsRequestSchema, () => client.listTools());
server.setRequestHandler(
  CallToolRequestSchema,
  async (request) => (await client.callTool(request.params)) as any,
);
await server.connect(new StdioServerTransport());
const stop = async () => {
  await server.close();
  await client.close();
};
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
