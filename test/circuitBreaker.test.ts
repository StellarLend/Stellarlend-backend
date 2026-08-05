import { beforeEach, describe, expect, it } from "vitest";

import {
  CircuitBreaker,
  CircuitState,
} from "../src/lib/http/circuitBreaker.js";

describe("CircuitBreaker", () => {
  let cb: CircuitBreaker;

  beforeEach(() => {
    cb = new CircuitBreaker();
  });

  // ---- closed state -----------------------------------------------

  describe("when closed", () => {
    it("allows calls", () => {
      expect(cb.shouldAllow("horizon.example.com")).toBe(true);
    });

    it("stays closed after successes below threshold", () => {
      for (let i = 0; i < 10; i++) {
        cb.recordSuccess("horizon.example.com");
      }
      expect(cb.shouldAllow("horizon.example.com")).toBe(true);
      expect(cb.getHostState("horizon.example.com").state).toBe(
        CircuitState.CLOSED,
      );
    });
  });

  // ---- open on failure threshold ---------------------------------

  describe("opens when failure threshold is exceeded", () => {
    it("opens after 50% failures exceeds threshold with min sample size", () => {
      const host = "soroban.example.com";
      // Success 2, Failure 4 -> 4/6 = 66.7% > 50% with 6 >= minSampleSize(5)
      cb.recordSuccess(host);
      cb.recordSuccess(host);
      cb.recordFailure(host);
      cb.recordFailure(host);
      cb.recordFailure(host);
      cb.recordFailure(host);

      expect(cb.getHostState(host).state).toBe(CircuitState.OPEN);
      expect(cb.shouldAllow(host)).toBe(false);
    });

    it("does not open before min sample size even if failure rate is high", () => {
      const host = "oracle.example.com";
      // Only 2 failures out of 2 -> 100% but < minSampleSize(5)
      cb.recordFailure(host);
      cb.recordFailure(host);

      expect(cb.getHostState(host).state).toBe(CircuitState.CLOSED);
      expect(cb.shouldAllow(host)).toBe(true);
    });

    it("opens on max consecutive failures regardless of ratio", () => {
      const cb20 = new CircuitBreaker({ maxConsecutiveFailures: 3 });
      const host = "webhook.example.com";
      cb20.recordFailure(host);
      cb20.recordFailure(host);
      cb20.recordFailure(host);

      expect(cb20.getHostState(host).state).toBe(CircuitState.OPEN);
    });

    it("does not open on max consecutive failures when under limit", () => {
      const cb20 = new CircuitBreaker({ maxConsecutiveFailures: 5 });
      const host = "webhook.example.com";
      cb20.recordFailure(host);
      cb20.recordFailure(host);
      cb20.recordFailure(host);
      cb20.recordSuccess(host); // resets consecutive count

      expect(cb20.getHostState(host).state).toBe(CircuitState.CLOSED);
    });
  });

  // ---- half-open -> close on success -------------------------------

  describe("half-open probe", () => {
    it("closes the circuit after a successful half-open probe", () => {
      const cbFast = new CircuitBreaker({
        cooldownMs: 0,
        minSampleSize: 0,
      });
      const host = "rpc.example.com";

      // Open the circuit
      cbFast.recordFailure(host);
      cbFast.recordFailure(host);
      cbFast.recordFailure(host);
      cbFast.recordFailure(host);
      cbFast.recordFailure(host);
      expect(cbFast.getHostState(host).state).toBe(CircuitState.OPEN);

      // Cooldown elapsed, should allow one probe
      expect(cbFast.shouldAllow(host)).toBe(true);
      expect(cbFast.getHostState(host).state).toBe(CircuitState.HALF_OPEN);

      // Successful probe closes the circuit
      cbFast.recordSuccess(host);
      expect(cbFast.getHostState(host).state).toBe(CircuitState.CLOSED);
      expect(cbFast.shouldAllow(host)).toBe(true);
    });

    it("re-opens the circuit after a failed half-open probe", () => {
      const cbFast = new CircuitBreaker({
        cooldownMs: 0,
        minSampleSize: 0,
      });
      const host = "rpc.example.com";

      // Open
      for (let i = 0; i < 5; i++) cbFast.recordFailure(host);
      expect(cbFast.getHostState(host).state).toBe(CircuitState.OPEN);

      // Probe allowed
      expect(cbFast.shouldAllow(host)).toBe(true);

      // Probe fails -> re-open
      cbFast.recordFailure(host);
      expect(cbFast.getHostState(host).state).toBe(CircuitState.OPEN);
      expect(cbFast.shouldAllow(host)).toBe(false);
    });

    it("only allows one probe in half-open state", () => {
      const cbFast = new CircuitBreaker({
        cooldownMs: 0,
        minSampleSize: 0,
      });
      const host = "api.example.com";

      for (let i = 0; i < 5; i++) cbFast.recordFailure(host);

      // First call triggers half-open, second call is denied
      expect(cbFast.shouldAllow(host)).toBe(true);
      expect(cbFast.shouldAllow(host)).toBe(false);
    });
  });

  // ---- cooldown --------------------------------------------------

  describe("cooldown", () => {
    it("stays open during cooldown", () => {
      const cbSlow = new CircuitBreaker({
        cooldownMs: 60_000,
        minSampleSize: 0,
      });
      const host = "slow.example.com";

      for (let i = 0; i < 5; i++) cbSlow.recordFailure(host);
      expect(cbSlow.getHostState(host).state).toBe(CircuitState.OPEN);
      expect(cbSlow.shouldAllow(host)).toBe(false);
    });
  });

  // ---- metrics ---------------------------------------------------

  describe("getMetrics", () => {
    it("returns per-host state snapshots", () => {
      cb.recordSuccess("a.example.com");
      cb.recordFailure("b.example.com");
      cb.recordFailure("b.example.com");

      const metrics = cb.getMetrics();
      expect(metrics).toHaveLength(2);

      const a = metrics.find((m) => m.host === "a.example.com")!;
      expect(a.state).toBe(CircuitState.CLOSED);
      expect(a.totalCount).toBe(1);

      const b = metrics.find((m) => m.host === "b.example.com")!;
      expect(b.state).toBe(CircuitState.CLOSED);
      expect(b.failureCount).toBe(2);
    });
  });

  // ---- host isolation ---------------------------------------------

  describe("host isolation", () => {
    it("tracks each host independently", () => {
      const hostA = "a.example.com";
      const hostB = "b.example.com";

      // Open hostA
      for (let i = 0; i < 5; i++) cb.recordFailure(hostA);
      expect(cb.getHostState(hostA).state).toBe(CircuitState.OPEN);

      // hostB is unaffected
      expect(cb.getHostState(hostB).state).toBe(CircuitState.CLOSED);
      expect(cb.shouldAllow(hostB)).toBe(true);
    });
  });

  // ---- custom options ---------------------------------------------

  describe("custom options", () => {
    it("respects custom failureThreshold", () => {
      const cbCustom = new CircuitBreaker({
        failureThreshold: 0.8,
        minSampleSize: 5,
      });
      const host = "custom.example.com";

      // 5 calls, 3 failures = 60% < 80% -> stays closed
      cbCustom.recordSuccess(host);
      cbCustom.recordSuccess(host);
      cbCustom.recordFailure(host);
      cbCustom.recordFailure(host);
      cbCustom.recordFailure(host);

      expect(cbCustom.getHostState(host).state).toBe(CircuitState.CLOSED);

      // Push to 80% one step at a time
      cbCustom.recordFailure(host); // 4/6 = 66.7%
      expect(cbCustom.getHostState(host).state).toBe(CircuitState.CLOSED);

      cbCustom.recordFailure(host); // 5/7 = 71.4%
      expect(cbCustom.getHostState(host).state).toBe(CircuitState.CLOSED);

      cbCustom.recordFailure(host); // 6/8 = 75%
      expect(cbCustom.getHostState(host).state).toBe(CircuitState.CLOSED);

      cbCustom.recordFailure(host); // 7/9 = 77.8%
      expect(cbCustom.getHostState(host).state).toBe(CircuitState.CLOSED);

      cbCustom.recordFailure(host); // 8/10 = 80% -> now open
      expect(cbCustom.getHostState(host).state).toBe(CircuitState.OPEN);
    });
  });

  // ---- getHostState -----------------------------------------------

  describe("getHostState", () => {
    it("returns a stable reference for successive calls", () => {
      const state1 = cb.getHostState("host.example.com");
      const state2 = cb.getHostState("host.example.com");
      expect(state1).toBe(state2);
    });

    it("returns CLOSED for unknown hosts", () => {
      expect(cb.getHostState("unknown.example.com").state).toBe(
        CircuitState.CLOSED,
      );
    });
  });
});
