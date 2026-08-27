import { describe, expect, it } from "vitest";
import { createCorrelationId, recordDependency, renderObservabilityMetrics } from "../src/lib/observability.js";

describe("observability", () => {
  it("accepts safe correlation IDs and replaces malformed or oversized values", () => {
    expect(createCorrelationId("req-123")).toBe("req-123");
    expect(createCorrelationId("bad value")).not.toBe("bad value");
    expect(createCorrelationId("x".repeat(129))).not.toBe("x".repeat(129));
  });

  it("normalizes dependency labels and records failures without secrets", () => {
    recordDependency("soroban", "error", 12);
    recordDependency("user-controlled-secret", "error", 4);
    const metrics = renderObservabilityMetrics();
    expect(metrics).toContain('dependency="soroban",outcome="error"');
    expect(metrics).toContain('dependency="other",outcome="error"');
    expect(metrics).not.toContain("user-controlled-secret");
  });
});
