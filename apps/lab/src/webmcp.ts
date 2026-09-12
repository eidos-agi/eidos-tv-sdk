// Current API uses document.modelContext; navigator is retained for older previews.
export interface PageTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}
interface ModelContext {
  registerTool: (
    tool: PageTool & {
      execute: (
        input: Record<string, unknown>,
        context?: { signal?: AbortSignal },
      ) => Promise<unknown>;
    },
    options?: { signal: AbortSignal },
  ) => unknown;
  unregisterTool?: (name: string) => unknown;
}
export async function registerWebMCP(
  tools: PageTool[],
  execute: (name: string, input: Record<string, unknown>) => Promise<unknown>,
  onStatus: (status: string) => void,
) {
  const context =
    (document as Document & { modelContext?: ModelContext }).modelContext ??
    (navigator as Navigator & { modelContext?: ModelContext }).modelContext;
  if (!context) {
    onStatus("WebMCP unavailable in this browser · MCP is ready");
    return () => {};
  }
  const controller = new AbortController();
  const registered: string[] = [];
  try {
    for (const tool of tools) {
      await context.registerTool(
        {
          ...tool,
          execute: async (input, ctx) => {
            if (ctx?.signal?.aborted) throw Error("Cancelled");
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(await execute(tool.name, input)),
                },
              ],
            };
          },
        },
        { signal: controller.signal },
      );
      registered.push(tool.name);
    }
    onStatus(`${registered.length} WebMCP tools registered`);
  } catch (e) {
    controller.abort();
    for (const name of registered) context.unregisterTool?.(name);
    onStatus(`WebMCP registration failed: ${(e as Error).message}`);
  }
  return () => {
    controller.abort();
    for (const name of registered) context.unregisterTool?.(name);
  };
}
