export type ToolHandler = (
  args: Record<string, unknown>,
) => Promise<unknown> | unknown;

export interface RegisteredTool {
  name: string;
  def: unknown;
  handler: ToolHandler;
}

export function createToolHarness() {
  const tools = new Map<string, RegisteredTool>();

  const server = {
    registerTool(name: string, def: unknown, handler: ToolHandler) {
      tools.set(name, { name, def, handler });
    },
  };

  return {
    server,
    async invoke(name: string, args: Record<string, unknown>) {
      const tool = tools.get(name);
      if (!tool) {
        throw new Error(`Tool not registered: ${name}`);
      }
      return tool.handler(args);
    },
    names() {
      return [...tools.keys()];
    },
  };
}
