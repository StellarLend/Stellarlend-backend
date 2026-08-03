import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestContext {
  requestId: string;
}

const requestContext = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(context: RequestContext, callback: () => T): T {
  return requestContext.run(context, callback);
}

export function getRequestId(): string | undefined {
  return requestContext.getStore()?.requestId;
}
