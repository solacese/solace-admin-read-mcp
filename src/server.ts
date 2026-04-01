import { config } from "./config.js";
import { registerTools } from "./tools.js";

const log = (msg: string) => process.stderr.write(`[solace-admin-read-mcp] ${msg}\n`);

if (config.transport === "stdio") {
  const { McpServer, StdioServerTransport } = await import(
    "@modelcontextprotocol/server"
  );
  const server = new McpServer({
    name: "solace-admin-read-mcp",
    version: "0.1.0",
  });
  registerTools(server);
  log(`SEMP broker: ${config.semp.baseUrl} (VPN: ${config.semp.vpn})`);
  if (config.eventPortal.token) {
    log("Event Portal: connected");
  } else {
    log("Event Portal: skipped (SOLACE_CLOUD_TOKEN not set)");
  }
  log("Starting in stdio mode");
  const transport = new StdioServerTransport();
  await server.connect(transport);
} else {
  log(`SEMP broker: ${config.semp.baseUrl} (VPN: ${config.semp.vpn})`);
  if (config.eventPortal.token) {
    log("Event Portal: connected");
  } else {
    log("Event Portal: skipped (SOLACE_CLOUD_TOKEN not set)");
  }
  const { startHttpServer } = await import("./http.js");
  startHttpServer();
}
