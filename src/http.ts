import { randomUUID } from "node:crypto";
import express, { type Request, type Response, type NextFunction } from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import cors from "cors";
import { minimatch } from "minimatch";
import { McpServer, isInitializeRequest } from "@modelcontextprotocol/server";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import { config } from "./config.js";
import { registerTools } from "./tools.js";

const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes

interface SessionEntry {
  transport: NodeStreamableHTTPServerTransport;
  lastActivity: number;
}

const sessions = new Map<string, SessionEntry>();

// Sweep stale sessions every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of sessions) {
    if (now - entry.lastActivity > SESSION_TTL_MS) {
      entry.transport.close?.();
      sessions.delete(id);
    }
  }
}, 5 * 60 * 1000).unref();

function createApp(): express.Express {
  const app = express();

  // 1. Security headers
  app.use(helmet());

  // 2. Rate limiter
  app.use(
    rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 60,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );

  // 3. CORS + DNS rebinding protection
  app.use(
    cors({
      origin: (origin, callback) => {
        // Allow requests with no origin (native MCP clients, curl)
        if (!origin) return callback(null, true);
        const allowed = config.http.allowedOrigins;
        if (allowed.length === 0 || allowed.some((o) => minimatch(origin, o))) {
          callback(null, true);
        } else {
          callback(new Error(`CORS: origin ${origin} not allowed`));
        }
      },
      exposedHeaders: ["Mcp-Session-Id"],
    }),
  );

  // 4. Bearer token auth
  function requireApiKey(req: Request, res: Response, next: NextFunction): void {
    const header = req.headers.authorization ?? "";
    const [scheme, token] = header.split(" ");
    if (scheme !== "Bearer" || token !== config.http.apiKey) {
      res.setHeader("WWW-Authenticate", 'Bearer realm="solace-admin-read-mcp"');
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    next();
  }

  // 5. JSON body parser
  app.use(express.json({ limit: "1mb" }));

  // ── MCP endpoint ────────────────────────────────────────────────────

  app.post("/mcp", requireApiKey, async (req: Request, res: Response) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    if (sessionId && sessions.has(sessionId)) {
      const entry = sessions.get(sessionId)!;
      entry.lastActivity = Date.now();
      await entry.transport.handleRequest(req, res, req.body);
      return;
    }

    if (!sessionId && isInitializeRequest(req.body)) {
      const transport = new NodeStreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          sessions.set(id, { transport, lastActivity: Date.now() });
        },
      });

      transport.onclose = () => {
        if (transport.sessionId) {
          sessions.delete(transport.sessionId);
        }
      };

      const server = new McpServer({
        name: "solace-admin-read-mcp",
        version: "0.1.0",
      });
      registerTools(server);
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      return;
    }

    res.status(400).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Bad Request: missing or invalid session" },
      id: null,
    });
  });

  app.get("/mcp", requireApiKey, async (req: Request, res: Response) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    const entry = sessionId ? sessions.get(sessionId) : undefined;
    if (entry) {
      entry.lastActivity = Date.now();
      await entry.transport.handleRequest(req, res);
    } else {
      res.status(400).json({ error: "Invalid or missing session" });
    }
  });

  app.delete("/mcp", requireApiKey, async (req: Request, res: Response) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    const entry = sessionId ? sessions.get(sessionId) : undefined;
    if (entry) {
      await entry.transport.handleRequest(req, res);
    } else {
      res.status(400).json({ error: "Invalid or missing session" });
    }
  });

  return app;
}

export function startHttpServer(): void {
  const app = createApp();
  const { port, host } = config.http;
  app.listen(port, host, () => {
    process.stderr.write(`solace-admin-read-mcp HTTP server listening on http://${host}:${port}/mcp\n`);
  });
}
