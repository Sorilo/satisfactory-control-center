import { randomUUID } from "node:crypto";

const OPAQUE_SERVER_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export interface RequestContext {
  requestId: string;
  route: string;
  serverId?: string;
}

/** Create a local correlation context; inbound client IDs are never trusted. */
export function createRequestContext(
  _request: Request,
  route: string,
  serverId?: string
): RequestContext {
  const boundedRoute = route.trim().slice(0, 160) || "/";
  return {
    requestId: randomUUID(),
    route: boundedRoute,
    ...(serverId && OPAQUE_SERVER_ID.test(serverId) ? { serverId } : {}),
  };
}

export function withRequestId(response: Response, context: RequestContext): Response {
  const headers = new Headers(response.headers);
  headers.set("X-Request-ID", context.requestId);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
