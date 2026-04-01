import axios, { type AxiosInstance, type AxiosError } from "axios";
import { config } from "./config.js";

const client: AxiosInstance = axios.create({
  baseURL: config.eventPortal.baseUrl,
  headers: { Authorization: `Bearer ${config.eventPortal.token}` },
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
      typeof data === "string" ? data.slice(0, 500) : "";

    let hint = "";
    if (status === 401) {
      hint = " Token expired or invalid. Regenerate in Solace Cloud > Token Management.";
    } else if (status === 403) {
      hint = " Token lacks Event Portal Read permission. Regenerate with that scope enabled.";
    } else if (status === 404) {
      hint = " Resource not found — verify the ID exists. Use the corresponding list tool to browse available resources.";
    }

    throw new Error(`Event Portal request failed (${status ?? "unknown"}): ${url}${detail ? " — " + detail : ""}${hint}`);
  }
  throw new Error(`Event Portal request failed: ${err instanceof Error ? err.message : String(err)}`);
}

export async function epGetAll<T>(path: string, params?: Record<string, string | number>): Promise<T[]> {
  const PAGE_SIZE = 100;
  const results: T[] = [];
  let pageNumber = 1;

  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const res = await client.get(path, {
        params: { pageSize: PAGE_SIZE, pageNumber, ...params },
      });
      const data: T[] = res.data?.data ?? [];
      results.push(...data);
      if (data.length < PAGE_SIZE) break;
      pageNumber++;
    }
  } catch (err) {
    sanitizeError(err);
  }

  return results;
}

export async function epGet<T>(path: string): Promise<T> {
  try {
    const res = await client.get(path);
    return res.data.data as T;
  } catch (err) {
    sanitizeError(err);
  }
}
