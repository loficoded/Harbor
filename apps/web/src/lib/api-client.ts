import type {
  ApiErrorResponse,
  GetAgentsResponse,
  GetHealthResponse,
  GetRedemptionResponse,
} from "@harbor/shared";

import { getClientEnv } from "@/lib/env";

export type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export type HarborApiClientOptions = Readonly<{
  baseUrl: string;
  fetchImpl?: FetchLike;
}>;

type QueryParams = Readonly<Record<string, string>>;

/** Error thrown when the API responds with a non-2xx status. */
export class HarborApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | null;
  readonly details: unknown;

  constructor(
    status: number,
    code: string,
    message: string,
    requestId: string | null,
    details: unknown,
  ) {
    super(message);
    this.name = "HarborApiError";
    this.status = status;
    this.code = code;
    this.requestId = requestId;
    this.details = details;
  }
}

/**
 * Normalize a configured base URL: trim whitespace and strip trailing slashes
 * so path joining is unambiguous. Throws on an empty value so misconfiguration
 * fails loudly rather than silently issuing requests against a relative path.
 */
export function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim();

  if (trimmed === "") {
    throw new Error("Harbor API base URL must not be empty");
  }

  return trimmed.replace(/\/+$/, "");
}

/**
 * Typed client for the read-only Harbor backend API (Prompt #15). Only base URL
 * handling and request plumbing live here; response-specific rendering belongs
 * to later prompts. `fetchImpl` is injectable so the client is unit testable
 * without a live server.
 */
export class HarborApiClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;

  constructor(options: HarborApiClientOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  }

  /** The normalized base URL this client targets. */
  get target(): string {
    return this.baseUrl;
  }

  /** Compose an absolute request URL from a path and optional query params. */
  buildUrl(path: string, query?: QueryParams): string {
    const suffix = path.startsWith("/") ? path : `/${path}`;
    const url = `${this.baseUrl}${suffix}`;

    if (query === undefined) {
      return url;
    }

    const search = new URLSearchParams(query).toString();
    return search === "" ? url : `${url}?${search}`;
  }

  getHealth(signal?: AbortSignal): Promise<GetHealthResponse> {
    return this.request<GetHealthResponse>("/health", undefined, signal);
  }

  getAgents(asset?: string, signal?: AbortSignal): Promise<GetAgentsResponse> {
    const query = asset === undefined ? undefined : { asset };
    return this.request<GetAgentsResponse>("/agents", query, signal);
  }

  getRedemption(
    id: string,
    signal?: AbortSignal,
  ): Promise<GetRedemptionResponse> {
    return this.request<GetRedemptionResponse>(
      `/redemptions/${encodeURIComponent(id)}`,
      undefined,
      signal,
    );
  }

  private async request<T>(
    path: string,
    query: QueryParams | undefined,
    signal: AbortSignal | undefined,
  ): Promise<T> {
    const url = this.buildUrl(path, query);
    const init: RequestInit = {
      method: "GET",
      headers: { accept: "application/json" },
    };

    if (signal !== undefined) {
      init.signal = signal;
    }

    const response = await this.fetchImpl(url, init);

    if (!response.ok) {
      throw await toApiError(response);
    }

    return (await response.json()) as T;
  }
}

async function toApiError(response: Response): Promise<HarborApiError> {
  const headerRequestId = response.headers.get("x-request-id");

  try {
    const body = (await response.json()) as Partial<ApiErrorResponse>;

    if (body.error) {
      return new HarborApiError(
        response.status,
        body.error.code,
        body.error.message,
        body.error.requestId ?? headerRequestId,
        body.error.details,
      );
    }
  } catch {
    // Body was not JSON; fall back to a status-derived error below.
  }

  return new HarborApiError(
    response.status,
    "unknown_error",
    `Request failed with status ${response.status}`,
    headerRequestId,
    null,
  );
}

/** Create a client using an explicit base URL or the resolved frontend env. */
export function createHarborApiClient(
  options?: Partial<HarborApiClientOptions>,
): HarborApiClient {
  const baseUrl = options?.baseUrl ?? getClientEnv().apiBaseUrl;
  const fetchImpl = options?.fetchImpl;

  return new HarborApiClient(
    fetchImpl === undefined ? { baseUrl } : { baseUrl, fetchImpl },
  );
}
