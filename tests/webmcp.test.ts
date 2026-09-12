import test from "node:test";
import assert from "node:assert/strict";
import { registerWebMCP } from "../apps/lab/src/webmcp";
test("WebMCP registration delegates to the shared API and cleans up", async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  const registered: any[] = [];
  const removed: string[] = [];
  const actions: unknown[] = [];
  const status: string[] = [];
  Object.defineProperty(globalThis, "document", {
    value: {
      modelContext: {
        registerTool: (tool: unknown) => registered.push(tool),
        unregisterTool: (name: string) => removed.push(name),
      },
    },
    configurable: true,
  });
  try {
    const stop = await registerWebMCP(
      [
        {
          name: "remote.press",
          description: "Press key",
          inputSchema: { type: "object" },
        },
      ],
      async (name, input) => {
        actions.push([name, input]);
        return { accepted: true };
      },
      (s) => status.push(s),
    );
    assert.equal(registered.length, 1);
    const response = await registered[0].execute({ key: "RIGHT" });
    assert.deepEqual(actions, [["remote.press", { key: "RIGHT" }]]);
    assert.match(response.content[0].text, /accepted/);
    stop();
    assert.deepEqual(removed, ["remote.press"]);
    assert.equal(status[0], "1 WebMCP tools registered");
  } finally {
    if (previous) Object.defineProperty(globalThis, "document", previous);
    else delete (globalThis as any).document;
  }
});
