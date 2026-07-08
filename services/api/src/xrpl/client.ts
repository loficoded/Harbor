import { setTimeout as sleep } from "node:timers/promises";

import { Client as XrplJsClient } from "xrpl/dist/npm/client/index.js";
import type {
  AccountTxRequest,
  AccountTxResponse,
  SubscribeRequest,
  TransactionStream,
  UnsubscribeRequest,
} from "xrpl/dist/npm/models/methods/index.js";

export const defaultXrplTestnetEndpoint = "wss://s.altnet.rippletest.net:51233";

export type XrplRequest =
  AccountTxRequest | SubscribeRequest | UnsubscribeRequest;

export type XrplTransport = Readonly<{
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  request(request: XrplRequest): Promise<unknown>;
  requestNextPage?(
    request: AccountTxRequest,
    response: AccountTxResponse,
  ): Promise<AccountTxResponse>;
  on(event: "transaction", listener: (transaction: unknown) => void): unknown;
  on(event: "error", listener: (...error: unknown[]) => void): unknown;
  on(event: "disconnected", listener: (code: number) => void): unknown;
  removeListener?(
    event: "transaction" | "error" | "disconnected",
    listener: (...args: never[]) => void,
  ): unknown;
}>;

export type XrplRetryOptions = Readonly<{
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
}>;

export type XrplClientOptions = XrplRetryOptions &
  Readonly<{
    transport?: XrplTransport;
  }>;

export type XrplObservationClient = Readonly<{
  request(request: XrplRequest): Promise<unknown>;
  requestNextPage?(
    request: AccountTxRequest,
    response: AccountTxResponse,
  ): Promise<AccountTxResponse>;
  subscribeToAccounts?(
    accounts: readonly string[],
    onTransaction: (transaction: unknown) => void,
    onError?: (error: Error) => void,
  ): Promise<() => Promise<void>>;
}>;

type ResolvedRetryOptions = Required<XrplRetryOptions>;

const defaultRetryOptions: ResolvedRetryOptions = {
  maxRetries: 3,
  initialDelayMs: 250,
  maxDelayMs: 5_000,
  sleep,
};

function resolveRetryOptions(
  options: XrplRetryOptions = {},
): ResolvedRetryOptions {
  return {
    maxRetries: options.maxRetries ?? defaultRetryOptions.maxRetries,
    initialDelayMs:
      options.initialDelayMs ?? defaultRetryOptions.initialDelayMs,
    maxDelayMs: options.maxDelayMs ?? defaultRetryOptions.maxDelayMs,
    sleep: options.sleep ?? defaultRetryOptions.sleep,
  };
}

function errorFromUnknown(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  return new Error(String(error));
}

export async function retryXrplOperation<T>(
  operation: () => Promise<T>,
  options: XrplRetryOptions = {},
): Promise<T> {
  const retryOptions = resolveRetryOptions(options);
  let delayMs = retryOptions.initialDelayMs;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retryOptions.maxRetries; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      if (attempt === retryOptions.maxRetries) {
        break;
      }

      await retryOptions.sleep(delayMs);
      delayMs = Math.min(delayMs * 2, retryOptions.maxDelayMs);
    }
  }

  throw errorFromUnknown(lastError);
}

export class RetryingXrplClient implements XrplObservationClient {
  private readonly transport: XrplTransport;
  private readonly retryOptions: ResolvedRetryOptions;

  constructor(
    endpoint = defaultXrplTestnetEndpoint,
    options: XrplClientOptions = {},
  ) {
    this.transport =
      options.transport ??
      (new XrplJsClient(endpoint) as unknown as XrplTransport);
    this.retryOptions = resolveRetryOptions(options);
  }

  async connect(): Promise<void> {
    if (this.transport.isConnected()) {
      return;
    }

    await retryXrplOperation(() => this.transport.connect(), this.retryOptions);
  }

  async disconnect(): Promise<void> {
    if (!this.transport.isConnected()) {
      return;
    }

    await this.transport.disconnect();
  }

  async request(request: XrplRequest): Promise<unknown> {
    await this.connect();

    return retryXrplOperation(async () => {
      try {
        return await this.transport.request(request);
      } catch (error) {
        await this.reconnect();
        throw error;
      }
    }, this.retryOptions);
  }

  async requestNextPage(
    request: AccountTxRequest,
    response: AccountTxResponse,
  ): Promise<AccountTxResponse> {
    await this.connect();

    if (this.transport.requestNextPage === undefined) {
      return this.request({
        ...request,
        marker: response.result.marker,
      }) as Promise<AccountTxResponse>;
    }

    return retryXrplOperation(async () => {
      try {
        return await this.transport.requestNextPage!(request, response);
      } catch (error) {
        await this.reconnect();
        throw error;
      }
    }, this.retryOptions);
  }

  async subscribeToAccounts(
    accounts: readonly string[],
    onTransaction: (transaction: unknown) => void,
    onError?: (error: Error) => void,
  ): Promise<() => Promise<void>> {
    const uniqueAccounts = [
      ...new Set(accounts.map((account) => account.trim())),
    ]
      .filter((account) => account.length > 0)
      .sort();

    if (uniqueAccounts.length === 0) {
      throw new Error("At least one XRPL account is required for subscription");
    }

    let stopped = false;
    let reconnecting: Promise<void> | null = null;

    const transactionListener = (transaction: unknown) => {
      onTransaction(transaction as TransactionStream);
    };
    const errorListener = (...errors: unknown[]) => {
      onError?.(errorFromUnknown(errors[0] ?? "XRPL client error"));
      void reconnectAndSubscribe();
    };
    const disconnectedListener = () => {
      void reconnectAndSubscribe();
    };
    const subscribe = async () => {
      await this.request({
        command: "subscribe",
        accounts: uniqueAccounts,
      });
    };
    const reconnectAndSubscribe = async () => {
      if (stopped) {
        return;
      }

      if (reconnecting !== null) {
        return reconnecting;
      }

      reconnecting = (async () => {
        try {
          await this.reconnect();
          await subscribe();
        } catch (error) {
          onError?.(errorFromUnknown(error));
        } finally {
          reconnecting = null;
        }
      })();

      return reconnecting;
    };

    this.transport.on("transaction", transactionListener);
    this.transport.on("error", errorListener);
    this.transport.on("disconnected", disconnectedListener);

    await subscribe();

    return async () => {
      stopped = true;
      this.removeListener("transaction", transactionListener);
      this.removeListener("error", errorListener);
      this.removeListener("disconnected", disconnectedListener);

      try {
        await this.request({
          command: "unsubscribe",
          accounts: uniqueAccounts,
        });
      } catch (error) {
        onError?.(errorFromUnknown(error));
      }
    };
  }

  private async reconnect(): Promise<void> {
    try {
      await this.disconnect();
    } catch {
      // A failed disconnect should not prevent the retry path from reconnecting.
    }

    await this.connect();
  }

  private removeListener(
    event: "transaction" | "error" | "disconnected",
    listener: (...args: never[]) => void,
  ): void {
    this.transport.removeListener?.(event, listener);
  }
}
