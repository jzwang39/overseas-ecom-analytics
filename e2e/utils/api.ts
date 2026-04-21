import { request, type APIRequestContext, type TestInfo } from "@playwright/test";
import path from "node:path";

export async function newAuthedApi(baseURL: string, testInfo?: TestInfo): Promise<APIRequestContext> {
  const storageState = path.join(process.cwd(), "e2e", ".auth", "storage.json");
  return request.newContext({
    baseURL,
    storageState,
    extraHTTPHeaders: {
      "x-e2e-test": testInfo?.testId ?? "",
    },
  });
}

export async function apiJson<T>(ctx: APIRequestContext, res: { ok(): boolean; status(): number; json(): Promise<unknown> }) {
  if (!res.ok()) {
    const body = await res.json().catch(() => null);
    throw new Error(`API ${res.status()} ${JSON.stringify(body)}`);
  }
  return (await res.json()) as T;
}

