import axios, { type AxiosInstance, type AxiosError } from "axios";
import { config } from "./config.js";

const client: AxiosInstance = axios.create({
  baseURL: config.semp.baseUrl,
  auth: { username: config.semp.username, password: config.semp.password },
  timeout: 10_000,
});

client.interceptors.request.use((req) => {
  // Never log the Authorization header
  if (req.headers) {
    const { Authorization, authorization, ...safe } = req.headers.toJSON?.() ?? {};
    void Authorization;
    void authorization;
    void safe;
  }
  return req;
});

function sanitizeError(err: unknown): never {
  if (axios.isAxiosError(err)) {
    const ae = err as AxiosError;
    const status = ae.response?.status;
    const url = ae.config?.url ?? "";
    const data = ae.response?.data;
    const detail =
      typeof data === "object" && data !== null && "meta" in data
        ? JSON.stringify((data as Record<string, unknown>).meta)
        : typeof data === "string"
          ? data.slice(0, 500)
          : "";

    let hint = "";
    if (status === 401) {
      hint = " Check SEMP_USERNAME and SEMP_PASSWORD. For Solace Cloud, use the Management credentials (not messaging client credentials).";
    } else if (status === 403) {
      hint = " The SEMP user lacks read authorization. Assign the read-only authorization class.";
    } else if (status === 404) {
      hint = " Resource not found — verify the name exists. Use the corresponding list tool to see available resources.";
    }

    throw new Error(`SEMP request failed (${status ?? "unknown"}): ${url}${detail ? " — " + detail : ""}${hint}`);
  }
  if (err instanceof Error && err.message.includes("ECONNREFUSED")) {
    throw new Error(`Cannot reach the Solace broker at ${config.semp.baseUrl}. Verify SEMP_BASE_URL and that the broker is running.`);
  }
  if (err instanceof Error && err.message.includes("ETIMEDOUT")) {
    throw new Error(`Connection to the Solace broker timed out. Check SEMP_BASE_URL and network/firewall settings.`);
  }
  throw new Error(`SEMP request failed: ${err instanceof Error ? err.message : String(err)}`);
}

export async function sempGetAll<T>(path: string, params?: Record<string, string | number>): Promise<T[]> {
  const results: T[] = [];
  let cursor: string | undefined;

  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const queryParams: Record<string, string | number> = { count: 100, ...params };
      if (cursor) {
        // Cursor is a full query string like "cursor=xxx", parse and merge
        const cursorParams = new URLSearchParams(cursor);
        for (const [k, v] of cursorParams) {
          queryParams[k] = v;
        }
      }

      const res = await client.get(path, { params: queryParams });
      const data = res.data?.data;
      if (Array.isArray(data)) {
        results.push(...data);
      }

      const nextCursor: string | undefined = res.data?.meta?.paging?.cursorQuery;
      if (!nextCursor) break;
      cursor = nextCursor;
    }
  } catch (err) {
    sanitizeError(err);
  }

  return results;
}

export async function sempGet<T>(path: string, params?: Record<string, string | number>): Promise<T> {
  try {
    const res = await client.get(path, params ? { params } : undefined);
    return res.data.data as T;
  } catch (err) {
    sanitizeError(err);
  }
}
