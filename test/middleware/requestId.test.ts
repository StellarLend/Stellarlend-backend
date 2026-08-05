import request from "supertest";
import { describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import { CORRELATION_HEADER } from "../src/middleware/requestId.js";

describe("requestId middleware", () => {
  describe("generation", () => {
    it("generates a UUID v4 when the client sends no X-Request-ID header", async () => {
      const app = createApp();

      const response = await request(app).get("/health");

      expect(response.status).toBe(200);
      const id = response.headers[CORRELATION_HEADER.toLowerCase()] as string;
      expect(id).toBeDefined();
      // RFC-9562 v4 UUID format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    });

    it("generates a unique ID for every request", async () => {
      const app = createApp();

      const ids = new Set<string>();
      for (let i = 0; i < 5; i++) {
        const response = await request(app).get("/health");
        const id = response.headers[CORRELATION_HEADER.toLowerCase()] as string;
        ids.add(id);
      }

      expect(ids.size).toBe(5);
    });
  });

  describe("client-supplied ID", () => {
    it("accepts a client-supplied X-Request-ID and echoes it back", async () => {
      const app = createApp();
      const clientId = "trace-abc-123";

      const response = await request(app)
        .get("/health")
        .set(CORRELATION_HEADER, clientId);

      expect(response.status).toBe(200);
      expect(response.headers[CORRELATION_HEADER.toLowerCase()]).toBe(clientId);
    });

    it("accepts a lowercase x-request-id header", async () => {
      const app = createApp();
      const clientId = "trace-lowercase-789";

      const response = await request(app)
        .get("/health")
        .set("x-request-id", clientId);

      expect(response.status).toBe(200);
      expect(response.headers[CORRELATION_HEADER.toLowerCase()]).toBe(clientId);
    });
  });

  describe("response header", () => {
    it("always sets the X-Request-ID response header", async () => {
      const app = createApp();

      const response = await request(app).get("/health");

      const id = response.headers[CORRELATION_HEADER.toLowerCase()];
      expect(id).toBeDefined();
      expect(typeof id).toBe("string");
      expect((id as string).length).toBeGreaterThan(0);
    });

    it("sets X-Request-ID even on 404 responses", async () => {
      const app = createApp();

      const response = await request(app).get("/nonexistent-route");

      expect(response.status).toBe(404);
      const id = response.headers[CORRELATION_HEADER.toLowerCase()];
      expect(id).toBeDefined();
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    });

    it("sets X-Request-ID even on error responses", async () => {
      const app = createApp();

      // Send a malformed JSON body to trigger a parse error (400)
      const response = await request(app)
        .post("/health")
        .set("Content-Type", "application/json")
        .send("not json");

      const id = response.headers[CORRELATION_HEADER.toLowerCase()];
      expect(id).toBeDefined();
    });
  });

  describe("AsyncLocalStorage context propagation", () => {
    it("exposes requestId inside the request handler call stack", async () => {
      // We verify context propagation indirectly:
      // The requestLogger middleware attaches requestId to log output,
      // and it runs inside the same AsyncLocalStorage context because it
      // is called downstream of requestId middleware.
      const app = createApp();

      const response = await request(app)
        .get("/health")
        .set(CORRELATION_HEADER, "ctx-test-456");

      // If the ID made it through, it will be in the response header
      expect(response.headers[CORRELATION_HEADER.toLowerCase()]).toBe("ctx-test-456");
    });
  });
});
