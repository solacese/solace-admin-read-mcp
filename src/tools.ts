import { z } from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/server";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { config } from "./config.js";
import { sempGetAll, sempGet } from "./semp.js";
import { epGetAll, epGet } from "./eventportal.js";

function errorResult(err: unknown): CallToolResult {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
}

function jsonResult(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

// Shared SEMP params
const sempParams = {
  vpn: z.string().default(config.semp.vpn).describe("Message VPN name"),
  select: z
    .string()
    .optional()
    .describe("Comma-separated list of fields to return (e.g. 'queueName,spooledMsgCount'). Omit to return all fields."),
};

function sempQueryParams(
  select: string | undefined,
  extra?: Record<string, string | number>,
): Record<string, string | number> | undefined {
  const params: Record<string, string | number> = { ...extra };
  if (select) params.select = select;
  return Object.keys(params).length > 0 ? params : undefined;
}

export function registerTools(server: McpServer): void {
  // ═══════════════════════════════════════════════════════════════════════
  //  SEMP v2 — Broker Tools
  // ═══════════════════════════════════════════════════════════════════════

  server.registerTool(
    "list_queues",
    {
      description:
        "List all queues in a Solace message VPN with their configuration — queue name, access type, max spool size, owner, ingress/egress enabled state. " +
        "This returns config-level data, NOT runtime stats. " +
        "To see message counts, spool usage, or consumer status for a specific queue, use get_queue_stats instead. " +
        "Use the select parameter to limit fields and reduce response size (e.g. select='queueName,egressEnabled').",
      inputSchema: z.object(sempParams),
    },
    async ({ vpn, select }): Promise<CallToolResult> => {
      try {
        return jsonResult(
          await sempGetAll(
            `/config/msgVpns/${encodeURIComponent(vpn)}/queues`,
            sempQueryParams(select),
          ),
        );
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "get_queue_stats",
    {
      description:
        "Get live runtime stats for a specific queue — spooled message count, spool usage in MB, bound consumer count, " +
        "message rates (ingress/egress), highest message ID spooled, and redelivery counters. " +
        "Requires the exact queue name. Use list_queues first if you need to find the name. " +
        "Use select to pick specific fields (e.g. select='queueName,spooledMsgCount,msgSpoolUsage,bindSuccessCount').",
      inputSchema: z.object({
        name: z.string().describe("Exact queue name"),
        ...sempParams,
      }),
    },
    async ({ name, vpn, select }): Promise<CallToolResult> => {
      try {
        return jsonResult(
          await sempGet(
            `/monitor/msgVpns/${encodeURIComponent(vpn)}/queues/${encodeURIComponent(name)}`,
            sempQueryParams(select),
          ),
        );
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "get_queue_subscriptions",
    {
      description:
        "Get the topic subscriptions for a specific queue — shows which topics are routed to this queue. " +
        "Essential for understanding message routing: which topic patterns cause messages to land in this queue. " +
        "Requires the exact queue name. Use list_queues first if you need to find the name.",
      inputSchema: z.object({
        name: z.string().describe("Exact queue name"),
        vpn: z.string().default(config.semp.vpn).describe("Message VPN name"),
      }),
    },
    async ({ name, vpn }): Promise<CallToolResult> => {
      try {
        return jsonResult(
          await sempGetAll(
            `/config/msgVpns/${encodeURIComponent(vpn)}/queues/${encodeURIComponent(name)}/subscriptions`,
          ),
        );
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "list_client_connections",
    {
      description:
        "List all currently connected clients in the VPN — client name, username, client IP and port, uptime, software version. " +
        "Shows who is connected right now, not historical connections. " +
        "Use select to pick specific fields (e.g. select='clientName,clientUsername,clientAddress').",
      inputSchema: z.object(sempParams),
    },
    async ({ vpn, select }): Promise<CallToolResult> => {
      try {
        return jsonResult(
          await sempGetAll(
            `/monitor/msgVpns/${encodeURIComponent(vpn)}/clients`,
            sempQueryParams(select),
          ),
        );
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "get_vpn_stats",
    {
      description:
        "Get aggregate runtime stats for the entire VPN — total rx/tx message counts, current connection count, " +
        "spool usage, subscription count, average message rates. " +
        "Good for a high-level health check. For per-queue detail, use get_queue_stats. " +
        "Use select to pick specific fields (e.g. select='msgVpnName,rxMsgCount,txMsgCount,currentSpoolUsageInMb').",
      inputSchema: z.object(sempParams),
    },
    async ({ vpn, select }): Promise<CallToolResult> => {
      try {
        return jsonResult(
          await sempGet(
            `/monitor/msgVpns/${encodeURIComponent(vpn)}`,
            sempQueryParams(select),
          ),
        );
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "list_topic_endpoints",
    {
      description:
        "List all topic endpoints in the VPN. Topic endpoints are durable endpoints that receive messages on a specific topic " +
        "(unlike queues which use subscription-based routing). Less common than queues in most deployments. " +
        "Use select to limit returned fields.",
      inputSchema: z.object(sempParams),
    },
    async ({ vpn, select }): Promise<CallToolResult> => {
      try {
        return jsonResult(
          await sempGetAll(
            `/config/msgVpns/${encodeURIComponent(vpn)}/topicEndpoints`,
            sempQueryParams(select),
          ),
        );
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  // ═══════════════════════════════════════════════════════════════════════
  //  Event Portal — Designer (only registered when token is configured)
  // ═══════════════════════════════════════════════════════════════════════

  if (!config.eventPortal.token) {
    return; // EP tools skipped — logged at startup by server.ts
  }

  server.registerTool(
    "list_application_domains",
    {
      description:
        "List all application domains in Solace Event Portal. Domains are the top-level grouping for applications, events, and schemas. " +
        "Returns each domain's ID, name, description, and stats. " +
        "Use the domain ID from these results to filter other EP tools (list_events, list_schemas, list_applications, etc.).",
      inputSchema: z.object({}),
    },
    async (): Promise<CallToolResult> => {
      try {
        return jsonResult(await epGetAll("/applicationDomains"));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "list_applications",
    {
      description:
        "List applications modeled in Event Portal — these are the design-time representation of software components that produce or consume events. " +
        "Returns name, domain, type, and version count. " +
        "Filter by domainId to narrow results (get IDs from list_application_domains). " +
        "To see which events an application produces/consumes, use get_application_version with a version ID from the response.",
      inputSchema: z.object({
        domainId: z.string().optional().describe("Application domain ID to filter by (get IDs from list_application_domains)"),
      }),
    },
    async ({ domainId }): Promise<CallToolResult> => {
      try {
        const params: Record<string, string> = {};
        if (domainId) params.applicationDomainId = domainId;
        return jsonResult(await epGetAll("/applications", params));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "get_application_version",
    {
      description:
        "Get a specific application version by its version ID. Returns the full version detail including " +
        "the list of declared produced events, consumed events, and consumers (queue subscriptions). " +
        "Use this to understand what events an application sends and receives.",
      inputSchema: z.object({
        id: z.string().describe("Application version ID (from the version list in list_applications results)"),
      }),
    },
    async ({ id }): Promise<CallToolResult> => {
      try {
        return jsonResult(await epGet(`/applicationVersions/${encodeURIComponent(id)}`));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "list_events",
    {
      description:
        "List events modeled in Event Portal. Events are the core design artifact — each represents a type of message that flows between applications " +
        "(e.g. 'OrderCreated', 'PaymentProcessed'). Returns name, domain, schema references, and version info. " +
        "Filter by domainId to narrow results (get IDs from list_application_domains).",
      inputSchema: z.object({
        domainId: z.string().optional().describe("Application domain ID to filter by (get IDs from list_application_domains)"),
      }),
    },
    async ({ domainId }): Promise<CallToolResult> => {
      try {
        const params: Record<string, string> = {};
        if (domainId) params.applicationDomainId = domainId;
        return jsonResult(await epGetAll("/events", params));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "list_schemas",
    {
      description:
        "List schemas in the Event Portal design catalog. Schemas define the payload structure of events (JSON Schema, Avro, Protobuf, XML). " +
        "Returns name, domain, content type, and version count. " +
        "Filter by domainId to narrow results. To see the actual schema content, use get_schema_version with a version ID.",
      inputSchema: z.object({
        domainId: z.string().optional().describe("Application domain ID to filter by (get IDs from list_application_domains)"),
      }),
    },
    async ({ domainId }): Promise<CallToolResult> => {
      try {
        const params: Record<string, string> = {};
        if (domainId) params.applicationDomainId = domainId;
        return jsonResult(await epGetAll("/schemas", params));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "get_schema_version",
    {
      description:
        "Get a specific schema version by its version ID. Returns the full schema content (the actual JSON Schema, Avro schema, etc.), " +
        "plus metadata like version number, state, and description. " +
        "Use this when you need to inspect the payload structure of an event.",
      inputSchema: z.object({
        id: z.string().describe("Schema version ID (from the version list in list_schemas results)"),
      }),
    },
    async ({ id }): Promise<CallToolResult> => {
      try {
        return jsonResult(await epGet(`/schemaVersions/${encodeURIComponent(id)}`));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "list_event_api_products",
    {
      description:
        "List Event API Products — these bundle one or more Event APIs into a publishable product for the API catalog. " +
        "Returns name, domain, approval type, and version info. " +
        "Filter by domainId to narrow results.",
      inputSchema: z.object({
        domainId: z.string().optional().describe("Application domain ID to filter by (get IDs from list_application_domains)"),
      }),
    },
    async ({ domainId }): Promise<CallToolResult> => {
      try {
        const params: Record<string, string> = {};
        if (domainId) params.applicationDomainId = domainId;
        return jsonResult(await epGetAll("/eventApiProducts", params));
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
