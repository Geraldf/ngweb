// WebMCP browser bridge for the Casa Baia Sant'Anna website.
//
// WebMCP (https://developer.chrome.com/docs/ai/webmcp) is an experimental browser
// API (Chrome 146+) that lets websites expose structured tools to AI agents via
// `document.modelContext`. This bridge fetches the site's tool catalog from the
// /mcp endpoint and registers proxy tools so that any WebMCP-capable browser can
// invoke them directly on the visitor's behalf, with their session and cookies.

// --- Type declarations for the experimental WebMCP API ---
interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<unknown>;
}

interface ModelContext {
  registerTool(tool: McpToolDefinition): void;
}

declare global {
  interface Document {
    modelContext?: ModelContext;
  }
}

// --- Implementation ---

const mcpUrl = "/mcp";

type McpToolMeta = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

async function fetchTools(): Promise<McpToolMeta[]> {
  try {
    const response = await fetch(mcpUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    if (!response.ok) return [];
    const data = await response.json();
    return (data?.result?.tools ?? []) as McpToolMeta[];
  } catch {
    return [];
  }
}

function isWebMcpSupported(): boolean {
  return typeof document !== "undefined" && typeof document.modelContext !== "undefined";
}

export function initWebMcpBridge(): void {
  if (!isWebMcpSupported()) return;

  const context = document.modelContext!;
  const tools = fetchTools();

  tools.then((catalog) => {
    for (const meta of catalog) {
      context.registerTool({
        ...meta,
        execute: async (args: Record<string, unknown>) => {
          const response = await fetch(mcpUrl, {
            method: "POST",
            credentials: "same-origin",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: crypto.randomUUID(),
              method: "tools/call",
              params: { name: meta.name, arguments: args },
            }),
          });
          const data = await response.json();
          if (data?.error) throw new Error(data.error.message ?? "Tool call failed");
          // Unwrap the MCP content envelope.
          const text = data?.result?.content?.[0]?.text;
          if (typeof text === "string") {
            try { return JSON.parse(text); } catch { return text; }
          }
          return data?.result;
        },
      });
    }
    console.info(`[webmcp] Registered ${catalog.length} tools with document.modelContext`);
  }).catch((error) => {
    console.warn("[webmcp] Failed to initialize bridge:", error);
  });
}

export {};
