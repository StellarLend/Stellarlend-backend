import { AsyncLocalStorage } from "async_hooks";

/** Holds per-request metadata threaded through the full call stack. */
interface RequestContext {
  requestId: string;
}

const contextStore = new AsyncLocalStorage<RequestContext>();

/**
 * Returns the entire request context, or `undefined` when called outside of
 * an HTTP request (e.g. during server bootstrap).
 */
export function getRequestContext(): RequestContext | undefined {
  return contextStore.getStore();
}

/** Returns the current request's correlation ID, or `undefined`. */
export function getRequestId(): string | undefined {
  return contextStore.getStore()?.requestId;
}

/**
 * Runs `fn` inside a context holding the given `requestId`.
 * Used by the request-id middleware to seed every handler.
 */
export function runWithContext<T>(requestId: string, fn: () => T): T {
  return contextStore.run({ requestId }, fn);
}
