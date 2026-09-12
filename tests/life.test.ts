import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { LifeCenter } from "../apps/server/src/life";
import { createLabServer } from "../apps/server/src/server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
test("Life Center remote delegates, survives screen sleep/restart, and supports cancellation", () => {
  const dir = mkdtempSync(join(tmpdir(), "life-test-"));
  let now = 10000;
  try {
    let life = new LifeCenter(dir, () => now);
    life.call("life.remote", { key: "Right" });
    let state = life.call("life.remote", { key: "Select" });
    assert.equal(state.jobs[0].kind, "travel");
    assert.equal(state.jobs[0].status, "queued");
    const id = state.jobs[0].id;
    life.call("life.remote", { key: "Power" });
    now += 2000;
    life = new LifeCenter(dir, () => now);
    assert.equal(life.observe().power, false);
    assert.equal(life.observe().jobs[0].status, "working");
    now += 3000;
    assert.equal(life.observe().jobs[0].status, "completed");
    assert.match(life.observe().jobs[0].result!, /No bookings/);
    assert.throws(() => life.call("life.cancel", { id }), /FINISHED/);
    state = life.call("life.request", { text: "Unrecognized specific job" });
    life.call("life.cancel", { id: state.jobs[0].id });
    now += 10000;
    assert.equal(life.observe().jobs[0].status, "cancelled");
    assert.throws(() => life.call("life.request", { text: "  " }));
    assert.throws(() => life.call("life.open", { id: "missing" }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("Life MCP and HTTP share jobs and deny unauthenticated and session-only clients", async () => {
  const dir = mkdtempSync(join(tmpdir(), "life-api-"));
  const lab = createLabServer({
    directory: dir,
    staticDir: resolve("apps/lab/dist"),
  });
  await new Promise<void>((r) => lab.server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(lab.server.address() as { port: number }).port}`;
  const client = new Client({ name: "life-test", version: "1" });
  const headers = {
    Authorization: `Bearer ${lab.operatorToken}`,
    "Content-Type": "application/json",
  };
  try {
    assert.equal((await fetch(base + "/api/life")).status, 401);
    const session = await (
      await fetch(base + "/api/sessions", {
        method: "POST",
        headers,
        body: "{}",
      })
    ).json();
    const grant = await (
      await fetch(base + `/api/sessions/${session.id}/grant`, {
        method: "POST",
        headers,
        body: "{}",
      })
    ).json();
    assert.equal(
      (
        await fetch(base + "/api/life", {
          headers: { Authorization: `Bearer ${grant.token}` },
        })
      ).status,
      403,
    );
    await client.connect(
      new StreamableHTTPClientTransport(new URL(base + "/life-mcp"), {
        requestInit: { headers },
      }),
    );
    assert.equal((await client.listTools()).tools.length, 5);
    await client.callTool({
      name: "life.request",
      arguments: { text: "Prepare my next trip" },
    });
    const view = await (await fetch(base + "/api/life", { headers })).json();
    assert.equal(view.jobs.length, 1);
    assert.equal(view.jobs[0].text, "Prepare my next trip");
    await client.callTool({
      name: "life.cancel",
      arguments: { id: view.jobs[0].id },
    });
    assert.equal(
      (await (await fetch(base + "/api/life", { headers })).json()).jobs[0]
        .status,
      "cancelled",
    );
  } finally {
    await client.close();
    lab.server.closeAllConnections();
    await new Promise<void>((r) => lab.server.close(() => r()));
    rmSync(dir, { recursive: true, force: true });
  }
});
