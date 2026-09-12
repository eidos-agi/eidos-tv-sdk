import test from "node:test";
import { request as httpRequest } from "node:http";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createLabServer } from "../apps/server/src/server";
import { Broker } from "../apps/server/src/broker";
import { NO_FAULTS } from "@eidos-tv/core";
async function setup() {
  const directory = await mkdtemp(join(tmpdir(), "eidos-tv-test-"));
  const lab = createLabServer({
    directory,
    staticDir: resolve("apps/lab/dist"),
  });
  await new Promise<void>((r) => lab.server.listen(0, "127.0.0.1", r));
  const port = (lab.server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}`;
  return {
    ...lab,
    directory,
    base,
    async close() {
      lab.server.closeAllConnections();
      await new Promise<void>((r) => lab.server.close(() => r()));
      await rm(directory, { recursive: true, force: true });
    },
  };
}
async function req(
  lab: Awaited<ReturnType<typeof setup>>,
  path: string,
  data?: unknown,
  token = lab.operatorToken,
  extra: Record<string, string> = {},
) {
  return fetch(lab.base + path, {
    method: data === undefined ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...extra,
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
}
test("HTTP and SDK MCP control the same TV, omit oracle, revoke access", async () => {
  const lab = await setup();
  const client = new Client({ name: "test-agent", version: "1" });
  try {
    const session = await (await req(lab, "/api/sessions", {})).json();
    const grant = await (
      await req(lab, `/api/sessions/${session.id}/grant`, {})
    ).json();
    await client.connect(
      new StreamableHTTPClientTransport(new URL(lab.base + "/mcp"), {
        requestInit: { headers: { Authorization: `Bearer ${grant.token}` } },
      }),
    );
    const tools = await client.listTools();
    assert.ok(tools.tools.some((t) => t.name === "remote.press"));
    assert.ok(
      !tools.tools.some(
        (t) => t.name === "tv.openContent" || t.name.includes("oracle"),
      ),
    );
    for (const key of ["SELECT", "RIGHT", "RIGHT", "SELECT"]) {
      const result = await client.callTool({
        name: "remote.press",
        arguments: { key },
      });
      assert.ok(!result.isError);
    }
    const observed = await (
      await req(lab, `/api/sessions/${session.id}`)
    ).json();
    assert.equal(observed.result.success, true);
    const agentView = await (
      await req(lab, `/api/sessions/${session.id}`, undefined, grant.token)
    ).json();
    assert.ok(!("result" in agentView));
    assert.ok(!("config" in agentView));
    assert.ok(!("trace" in agentView));
    const denied = await client.callTool({
      name: "tv.openContent",
      arguments: { contentId: "bluey" },
    });
    assert.equal(denied.isError, true);
    await req(lab, `/api/sessions/${session.id}/takeover`, {});
    assert.equal(
      (await req(lab, `/api/sessions/${session.id}`, undefined, grant.token))
        .status,
      401,
    );
  } finally {
    await client.close();
    await lab.close();
  }
});
test("stdio adapter uses the shared HTTP session", async () => {
  const lab = await setup();
  const client = new Client({ name: "stdio-test", version: "1" });
  try {
    const id = lab.broker.create();
    const grant = lab.broker.grant(id);
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        (e): e is [string, string] => e[1] !== undefined,
      ),
    );
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: ["--import", "tsx", "apps/mcp/src/main.ts"],
        env: {
          ...env,
          EIDOS_TV_SESSION_TOKEN: grant.token,
          EIDOS_TV_MCP_URL: lab.base + "/mcp",
        },
      }),
    );
    await client.callTool({
      name: "remote.press",
      arguments: { key: "RIGHT" },
    });
    assert.equal(lab.broker.session(id).snapshot().focusIndex, 1);
  } finally {
    await client.close();
    await lab.close();
  }
});
test("HTTP rejects cross-origin, bad Host, unknown tokens, session escapes and forged actor", async () => {
  const lab = await setup();
  try {
    const id = lab.broker.create();
    const other = lab.broker.create();
    const grant = lab.broker.grant(id);
    assert.equal((await req(lab, "/api/me", undefined, "invalid")).status, 401);
    assert.equal(
      (
        await req(lab, "/api/me", undefined, lab.operatorToken, {
          Origin: "https://evil.example",
        })
      ).status,
      403,
    );
    assert.equal(
      await new Promise<number>((r) => {
        const request = httpRequest(
          lab.base + "/health",
          { headers: { Host: "evil.example" } },
          (res) => {
            res.resume();
            r(res.statusCode!);
          },
        );
        request.end();
      }),
      403,
    );
    assert.equal(
      (await req(lab, `/api/sessions/${other}`, undefined, grant.token)).status,
      403,
    );
    assert.equal(
      (await req(lab, `/api/sessions/${id}/grant`, {}, grant.token)).status,
      403,
    );
    assert.equal(
      (
        await req(
          lab,
          `/api/sessions/${id}/action`,
          {
            name: "remote.press",
            input: { key: "RIGHT" },
            requestId: randomUUID(),
            actor: { kind: "human" },
          },
          grant.token,
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await req(lab, `/api/sessions/${id}/action`, {
          name: "remote.press",
          input: { key: "RIGHT" },
          requestId: randomUUID(),
        })
      ).status,
      400,
    );
  } finally {
    await lab.close();
  }
});
test("reset revokes grant, discards pending PTT, clears metrics, persistence restores full trace", async () => {
  const lab = await setup();
  try {
    const id = lab.broker.create({ latencyMs: 500 });
    const grant = lab.broker.grant(id);
    lab.broker.agentCall(
      grant.token,
      "remote.pttStart",
      { sessionId: "one" },
      "start",
    );
    lab.broker.agentCall(
      grant.token,
      "remote.pttSpeak",
      { sessionId: "one", text: "play Bluey episode 3", confidence: 1 },
      "speak",
    );
    const restored = new Broker(lab.directory);
    restored.restore(id);
    assert.deepEqual(
      restored.session(id).snapshot(),
      lab.broker.session(id).snapshot(),
    );
    lab.broker.reset(id, { ...lab.broker.session(id).config, latencyMs: 0 });
    assert.throws(() => lab.broker.authenticate(grant.token), /INVALID_GRANT/);
    assert.equal(lab.broker.session(id).actions.length, 0);
    assert.equal(lab.broker.session(id).snapshot().voice?.active, false);
  } finally {
    await lab.close();
  }
});
test("visual mode advertises zero tools; semantic grant cannot self-select higher scope", async () => {
  const lab = await setup();
  try {
    const id = lab.broker.create({ authority: "visual-only" });
    assert.equal(lab.broker.tools(id).length, 0);
    const grant = lab.broker.grant(id);
    assert.throws(
      () => lab.broker.agentCall(grant.token, "tv.observe", {}, "x"),
      /AUTHORITY_DENIED/,
    );
    assert.throws(
      () =>
        lab.broker.agentCall(
          grant.token,
          "remote.press",
          { key: "RIGHT" },
          "y",
        ),
      /AUTHORITY_DENIED/,
    );
    lab.broker.agentCall(
      grant.token,
      "remote.press",
      { key: "RIGHT" },
      "z",
      "ui",
    );
    assert.equal(lab.broker.session(id).snapshot().focusIndex, 1);
  } finally {
    await lab.close();
  }
});

test("stale revisions cannot issue grants or mutate a reset session", async () => {
  const lab = await setup();
  try {
    const id = lab.broker.create();
    const revision = lab.broker.projection(id).revision;
    lab.broker.reset(id, lab.broker.session(id).config);
    assert.throws(() => lab.broker.grant(id, revision), /STALE_SESSION/);
    const response = await req(lab, `/api/sessions/${id}/action`, {
      name: "remote.press",
      input: { key: "RIGHT" },
      requestId: "stale",
      revision,
    });
    assert.equal(response.status, 400);
    assert.equal(lab.broker.session(id).snapshot().focusIndex, 0);
  } finally {
    await lab.close();
  }
});
test("takeover clears held keys and cancels delayed PTT without a late transition", async () => {
  const lab = await setup();
  try {
    const id = lab.broker.create({ latencyMs: 500 });
    const grant = lab.broker.grant(id);
    lab.broker.agentCall(
      grant.token,
      "remote.keyDown",
      { key: "RIGHT" },
      "down",
    );
    lab.broker.agentCall(
      grant.token,
      "remote.pttStart",
      { sessionId: "voice" },
      "start",
    );
    lab.broker.agentCall(
      grant.token,
      "remote.pttSpeak",
      { sessionId: "voice", text: "play Bluey episode 3", confidence: 1 },
      "speak",
    );
    lab.broker.revoke(id);
    const next = lab.broker.grant(id);
    lab.broker.agentCall(
      next.token,
      "remote.keyDown",
      { key: "RIGHT" },
      "new-down",
    );
    lab.broker.agentCall(next.token, "session.wait", { ms: 1000 }, "wait");
    assert.equal(lab.broker.session(id).snapshot().playback.state, "idle");
    assert.equal(lab.broker.session(id).snapshot().voice?.active, false);
  } finally {
    await lab.close();
  }
});

test("late reset is rejected without replacing the newer session", async () => {
  const lab = await setup();
  try {
    const id = lab.broker.create();
    const first = lab.broker.projection(id);
    lab.broker.reset(
      id,
      { ...first.config, authority: "semantic" },
      first.revision,
    );
    const response = await req(lab, `/api/sessions/${id}/reset`, {
      ...first.config,
      revision: first.revision,
    });
    assert.equal(response.status, 400);
    assert.equal(lab.broker.session(id).config.authority, "semantic");
  } finally {
    await lab.close();
  }
});
