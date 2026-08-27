import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

const context = new AsyncLocalStorage<{ correlationId: string }>();
const ALLOWED_DEPENDENCIES = new Set(["prisma", "soroban", "oracle", "indexer"]);
type Dependency = "prisma" | "soroban" | "oracle" | "indexer" | "other";
type Outcome = "success" | "error";

const counters = new Map<string, number>();
const durations = new Map<string, { count: number; sumMs: number }>();

export function createCorrelationId(candidate?: unknown): string {
  if (typeof candidate === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(candidate)) return candidate;
  return randomUUID();
}

export function runWithCorrelationId<T>(correlationId: string, fn: () => T): T {
  return context.run({ correlationId }, fn);
}

export function getCorrelationId(): string | undefined {
  return context.getStore()?.correlationId;
}

function normalizeDependency(name: string): Dependency {
  return ALLOWED_DEPENDENCIES.has(name) ? name as Dependency : "other";
}

export function recordDependency(name: string, outcome: Outcome, durationMs: number): void {
  const dependency = normalizeDependency(name);
  const counterKey = `${dependency}:${outcome}`;
  counters.set(counterKey, (counters.get(counterKey) ?? 0) + 1);
  const current = durations.get(dependency) ?? { count: 0, sumMs: 0 };
  current.count += 1;
  current.sumMs += Math.max(0, durationMs);
  durations.set(dependency, current);
}

/** Prometheus text with bounded dependency/outcome labels and no request data. */
export function renderObservabilityMetrics(): string {
  const lines = [
    "# HELP stellarlend_dependency_operations_total External dependency operations by outcome.",
    "# TYPE stellarlend_dependency_operations_total counter",
  ];
  for (const [key, value] of counters) {
    const [dependency, outcome] = key.split(":");
    lines.push(`stellarlend_dependency_operations_total{dependency="${dependency}",outcome="${outcome}"} ${value}`);
  }
  lines.push(
    "# HELP stellarlend_dependency_duration_ms_sum Sum of dependency durations in milliseconds.",
    "# TYPE stellarlend_dependency_duration_ms_sum counter",
  );
  for (const [dependency, value] of durations) {
    lines.push(`stellarlend_dependency_duration_ms_sum{dependency="${dependency}"} ${value.sumMs}`);
  }
  return `${lines.join("\n")}\n`;
}
