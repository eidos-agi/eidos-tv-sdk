import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { z } from "zod";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { replay, SCENARIOS, configSchema } from "@eidos-tv/core";
import { Broker } from "./broker";
const actionSchema = z
  .object({
    name: z.string().max(80),
    input: z.record(z.string(), z.unknown()).default({}),
    requestId: z.string().min(1).max(100),
    revision: z.number().int().positive().optional(),
    transport: z.enum(["ui", "webmcp", "internal"]).optional(),
  })
  .strict();
const traceSchema = z
  .object({
    version: z.literal(1),
    config: configSchema,
    actions: z
      .array(
        z
          .object({
            id: z.string().max(100),
            actor: z
              .object({
                id: z.string().max(100),
                kind: z.enum(["human", "agent", "system"]),
                transport: z.enum(["ui", "webmcp", "mcp", "internal"]),
              })
              .strict(),
            name: z.string().max(80),
            input: z.record(z.string(), z.unknown()),
            ok: z.boolean(),
            error: z.string().optional(),
          })
          .strict(),
      )
      .max(1001),
    finalStateHash: z.string().regex(/^[\da-f]{8}$/),
  })
  .strict();
async function body(req: IncomingMessage) {
  let text = "";
  for await (const chunk of req) {
    text += chunk;
    if (text.length > 1_000_000) throw Error("BODY_TOO_LARGE");
  }
  return text ? JSON.parse(text) : {};
}
function json(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(value));
}
const equal = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export function createLabServer(options: {
  directory: string;
  staticDir: string;
  operatorToken?: string;
}) {
  const broker = new Broker(options.directory);
  const operatorToken =
    options.operatorToken ?? randomBytes(32).toString("base64url");
  const server = createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; media-src 'self' blob:; frame-ancestors 'none'",
    );
    try {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      if (
        ![`127.0.0.1:${port}`, `localhost:${port}`].includes(
          req.headers.host ?? "",
        )
      )
        return json(res, 403, { error: "HOST_DENIED" });
      if (
        req.headers.origin &&
        !["http://127.0.0.1:" + port, "http://localhost:" + port].includes(
          req.headers.origin,
        )
      )
        return json(res, 403, { error: "ORIGIN_DENIED" });
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname === "/health")
        return json(res, 200, {
          ok: true,
          service: "eidos-tv-sdk",
          version: "0.1.0",
        });
      if (url.pathname.startsWith("/api") || url.pathname === "/mcp") {
        const token = req.headers.authorization?.replace(/^Bearer /, "") ?? "";
        const operator = equal(token, operatorToken);
        let grant: ReturnType<Broker["authenticate"]> | undefined;
        if (!operator) {
          try {
            grant = broker.authenticate(token);
          } catch {
            return json(res, 401, { error: "UNAUTHORIZED" });
          }
        }
        if (url.pathname === "/mcp") {
          if (operator) return json(res, 403, { error: "USE_SESSION_GRANT" });
          if (req.method !== "POST")
            return json(res, 405, { error: "METHOD_NOT_ALLOWED" });
          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
            enableJsonResponse: true,
          });
          const mcp = new Server(
            { name: "eidos-tv-lab", version: "0.1.0" },
            { capabilities: { tools: {} } },
          );
          mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
            tools: broker.tools(grant!.sessionId) as any,
          }));
          mcp.setRequestHandler(CallToolRequestSchema, async (request) => {
            try {
              return {
                content: [
                  {
                    type: "text",
                    text: JSON.stringify(
                      broker.agentCall(
                        token,
                        request.params.name,
                        request.params.arguments ?? {},
                        randomUUID(),
                      ),
                    ),
                  },
                ],
              };
            } catch (e) {
              return {
                isError: true,
                content: [{ type: "text", text: (e as Error).message }],
              };
            }
          });
          res.on("close", () => {
            void transport.close();
            void mcp.close();
          });
          await mcp.connect(transport);
          await transport.handleRequest(req, res, await body(req));
          return;
        }
        if (url.pathname === "/api/scenarios" && req.method === "GET")
          return json(res, 200, SCENARIOS);
        if (url.pathname === "/api/me" && req.method === "GET")
          return json(
            res,
            200,
            operator
              ? { operator: true, sessions: [...broker.sessions.keys()] }
              : { operator: false, sessionId: grant!.sessionId },
          );
        if (
          url.pathname === "/api/sessions" &&
          req.method === "POST" &&
          operator
        ) {
          const id = broker.create(await body(req));
          return json(res, 201, broker.projection(id));
        }
        if (url.pathname === "/api/runs" && req.method === "GET" && operator)
          return json(res, 200, broker.runs());
        if (
          url.pathname === "/api/replay" &&
          req.method === "POST" &&
          operator
        ) {
          const p = await body(req);
          const file = traceSchema.parse(p.trace);
          const through = z
            .number()
            .int()
            .min(0)
            .max(file.actions.length)
            .parse(p.through ?? file.actions.length);
          const s = replay(file, through);
          return json(res, 200, {
            observation: s.observe(),
            trace: s.trace,
            verified: through === file.actions.length,
          });
        }
        const match = url.pathname.match(
          /^\/api\/sessions\/([\da-f-]{36})(?:\/(\w+))?$/,
        );
        if (match) {
          const [, id, action] = match;
          if (!operator && id !== grant!.sessionId)
            return json(res, 403, { error: "SESSION_DENIED" });
          if (action === "tools" && req.method === "GET")
            return json(res, 200, broker.tools(id));
          if (!action && req.method === "GET")
            return json(
              res,
              200,
              operator ? broker.projection(id) : broker.publicProjection(id),
            );
          if (action === "action" && req.method === "POST") {
            const p = actionSchema.parse(await body(req));
            const result = operator
              ? broker.call(
                  id,
                  { id: "operator", kind: "human", transport: "ui" },
                  p.name,
                  p.input,
                  p.requestId,
                  p.revision,
                )
              : broker.agentCall(
                  token,
                  p.name,
                  p.input,
                  p.requestId,
                  p.transport ?? "webmcp",
                );
            return json(res, 200, {
              result,
              ...(operator ? { session: broker.projection(id) } : {}),
            });
          }
          if (operator) {
            if (action === "grant" && req.method === "POST")
              return json(
                res,
                201,
                broker.grant(id, (await body(req)).revision),
              );
            if (action === "revoke" && req.method === "POST") {
              broker.revokeToken(z.string().parse((await body(req)).token));
              return json(res, 200, { ok: true });
            }
            if (action === "takeover" && req.method === "POST") {
              broker.revoke(id);
              return json(res, 200, { ok: true });
            }
            if (action === "reset" && req.method === "POST") {
              const { revision, ...config } = await body(req);
              broker.reset(id, config, revision);
              return json(res, 200, broker.projection(id));
            }
            if (action === "trace" && req.method === "GET")
              return json(res, 200, broker.session(id).export());
            if (action === "restore" && req.method === "POST")
              return json(res, 200, broker.restore(id));
          }
        }
        return json(res, 403, { error: "OPERATION_DENIED" });
      }
      if (req.method !== "GET")
        return json(res, 405, { error: "METHOD_NOT_ALLOWED" });
      const base = resolve(options.staticDir);
      const file = resolve(
        base,
        "." +
          decodeURIComponent(
            url.pathname === "/" || url.pathname === "/agent"
              ? "/index.html"
              : url.pathname,
          ),
      );
      if (!file.startsWith(base + sep))
        return json(res, 403, { error: "PATH_DENIED" });
      if (!(await stat(file)).isFile())
        return json(res, 404, { error: "NOT_FOUND" });
      const types: Record<string, string> = {
        ".html": "text/html",
        ".js": "text/javascript",
        ".css": "text/css",
        ".svg": "image/svg+xml",
        ".png": "image/png",
      };
      res.writeHead(200, {
        "content-type": types[extname(file)] ?? "application/octet-stream",
      });
      res.end(await readFile(file));
    } catch (e) {
      const message =
        e instanceof z.ZodError ? "INVALID_INPUT" : (e as Error).message;
      json(res, message === "SESSION_NOT_FOUND" ? 404 : 400, {
        error: message,
      });
    }
  });
  return { server, broker, operatorToken };
}
