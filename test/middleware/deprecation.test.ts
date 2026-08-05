import request from "supertest";
import { describe, expect, it } from "vitest";
import express from "express";

import { deprecation } from "../../src/middleware/deprecation.js";

function createDeprecatedApp(sunset: string, link?: string) {
  const app = express();
  app.disable("x-powered-by");

  // Deprecated v1 routes
  const v1 = express.Router();
  v1.use(deprecation({ sunset, link }));
  v1.get("/test", (_req, res) => {
    res.json({ ok: true });
  });

  // Active v2 routes (no deprecation)
  const v2 = express.Router();
  v2.get("/test", (_req, res) => {
    res.json({ ok: true });
  });

  app.use("/api/v1", v1);
  app.use("/api/v2", v2);
  return app;
}

describe("deprecation middleware", () => {
  const futureDate = "2099-12-31";

  it("adds Deprecation and Sunset headers to deprecated routes", async () => {
    const app = createDeprecatedApp(futureDate);
    const res = await request(app).get("/api/v1/test");

    expect(res.status).toBe(200);
    expect(res.headers["deprecation"]).toBe("true");
    expect(res.headers["sunset"]).toBeDefined();
    expect(res.headers["sunset"]).toMatch(
      /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4}/,
    );
  });

  it("does NOT add deprecation headers to non-deprecated routes", async () => {
    const app = createDeprecatedApp(futureDate);
    const res = await request(app).get("/api/v2/test");

    expect(res.status).toBe(200);
    expect(res.headers["deprecation"]).toBeUndefined();
    expect(res.headers["sunset"]).toBeUndefined();
  });

  it("adds optional Link header when provided", async () => {
    const app = createDeprecatedApp(futureDate, "/docs/api-v2-migration");
    const res = await request(app).get("/api/v1/test");

    expect(res.headers["link"]).toContain('rel="deprecation"');
  });

  it("omits Link header when not provided", async () => {
    const app = createDeprecatedApp(futureDate); // no link
    const res = await request(app).get("/api/v1/test");

    expect(res.headers["link"]).toBeUndefined();
  });

  it("preserves the response body and status code", async () => {
    const app = createDeprecatedApp(futureDate);
    const res = await request(app).get("/api/v1/test");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("rejects invalid sunset dates at creation time", () => {
    expect(() => deprecation({ sunset: "not-a-date" })).toThrow(TypeError);
  });

  it("accepts a valid ISO 8601 date string", () => {
    expect(() => deprecation({ sunset: "2026-03-01" })).not.toThrow();
  });

  it("Sunset header uses HTTP-date format (RFC 7231)", async () => {
    const app = createDeprecatedApp("2026-06-30");
    const res = await request(app).get("/api/v1/test");

    // RFC 7231 IMF-fixdate format: Tue, 30 Jun 2026 00:00:00 GMT
    const sunset = res.headers["sunset"] as string;
    expect(sunset).toBeDefined();
    // Must be a valid Date.parse result
    expect(Date.parse(sunset)).not.toBeNaN();
    // Must end with GMT
    expect(sunset).toMatch(/ GMT$/);
  });
});
