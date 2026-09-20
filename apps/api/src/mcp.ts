// MCP (Model Context Protocol) server for the Casa Baia Sant'Anna website.
// Lets AI agents discover and call site tools via JSON-RPC 2.0 over HTTP.
// The browser bridge on the client registers these same tools with document.modelContext
// so WebMCP-capable browsers can invoke them directly on behalf of the visitor.

import { Router } from "express";

export type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
};

export type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string };
};

type McpToolMeta = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

// Tool handlers receive the raw args object and return a serializable value.
type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

export type McpToolSet = Record<string, McpToolMeta & { handler: ToolHandler }>;

export function createJsonRpcResponse(id: string | number | null, result?: unknown, error?: { code: number; message: string }): JsonRpcResponse {
  return { jsonrpc: "2.0", id, ...(error ? { error } : { result }) };
}

export function createMcpRouter(tools: McpToolSet): Router {
  const router = Router();

  // Build a catalog of tools without their handlers for tools/list.
  const toolList: McpToolMeta[] = Object.values(tools).map(({ handler: _handler, ...meta }) => meta);

  async function handleRequest(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    const id = request.id ?? null;
    try {
      switch (request.method) {
        case "initialize":
          return createJsonRpcResponse(id, {
            protocolVersion: "2025-03-26",
            capabilities: { tools: {} },
            serverInfo: { name: "casa-baia-sant-anna", version: "1.0.0" },
          });
        case "tools/list":
          return createJsonRpcResponse(id, { tools: toolList });
        case "tools/call": {
          const params = (request.params ?? {}) as { name: string; arguments?: Record<string, unknown> };
          const tool = tools[params.name];
          if (!tool) return createJsonRpcResponse(id, undefined, { code: -32602, message: `Unknown tool: ${params.name}` });
          try {
            const result = await tool.handler(params.arguments ?? {});
            return createJsonRpcResponse(id, { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] });
          } catch (error) {
            return createJsonRpcResponse(id, undefined, { code: -32603, message: error instanceof Error ? error.message : "Tool execution failed" });
          }
        }
        default:
          return createJsonRpcResponse(id, undefined, { code: -32601, message: `Method not found: ${request.method}` });
      }
    } catch (error) {
      return createJsonRpcResponse(id, undefined, { code: -32603, message: error instanceof Error ? error.message : "Internal error" });
    }
  }

  router.post("/", async (request, response) => {
    try {
      const body = request.body as JsonRpcRequest;
      if (!body || body.jsonrpc !== "2.0" || !body.method) {
        response.json(createJsonRpcResponse(null, undefined, { code: -32600, message: "Invalid Request" }));
        return;
      }
      response.json(await handleRequest(body));
    } catch (error) {
      response.json(createJsonRpcResponse(null, undefined, { code: -32603, message: error instanceof Error ? error.message : "Internal error" }));
    }
  });

  return router;
}
