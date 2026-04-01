import { z } from "zod/v4";

function env(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. Add it to your environment or .env file.`);
  }
  return value;
}

const transport = z.enum(["stdio", "http"]).parse(process.env.TRANSPORT ?? "stdio");

const apiKey = process.env.MCP_API_KEY?.trim() ?? "";
if (transport === "http") {
  if (!apiKey) {
    throw new Error(
      "MCP_API_KEY is required when TRANSPORT=http. Generate one with:\n  node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    );
  }
  if (apiKey.length < 32) {
    throw new Error("MCP_API_KEY must be at least 32 characters long.");
  }
}

export const config = {
  transport,
  semp: {
    baseUrl: env("SEMP_BASE_URL"),
    username: env("SEMP_USERNAME"),
    password: env("SEMP_PASSWORD"),
    vpn: env("SOLACE_VPN"),
  },
  eventPortal: {
    baseUrl: "https://api.solace.cloud/api/v2/architecture",
    token: process.env.SOLACE_CLOUD_TOKEN?.trim() ?? "",
  },
  http: {
    port: Number(process.env.HTTP_PORT ?? 3000),
    host: process.env.HTTP_HOST ?? "127.0.0.1",
    apiKey,
    allowedOrigins: (process.env.ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  },
};
