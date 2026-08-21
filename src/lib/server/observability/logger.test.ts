import { describe, expect, it } from "vitest";
import { createStructuredLogger, redactSensitiveText } from "./logger";

describe("structured logger", () => {
  it("emits one-line JSON with stable fields and no private transport details", () => {
    const lines: string[] = [];
    const logger = createStructuredLogger((line) => lines.push(line));
    logger.warn({
      message: "upstream request failed https://example.invalid/read?query-marker",
      requestId: "request-1",
      route: "/api/v1/overview",
      code: "UPSTREAM_UNAVAILABLE",
    });

    expect(lines).toHaveLength(1);
    const record = JSON.parse(lines[0]!);
    expect(record).toMatchObject({
      level: "warn",
      requestId: "request-1",
      route: "/api/v1/overview",
      code: "UPSTREAM_UNAVAILABLE",
    });
    expect(JSON.stringify(record)).not.toMatch(/example|invalid|query-marker/i);
  });

  it("redacts common secret-bearing text before it reaches the sink", () => {
    expect(redactSensitiveText("Authorization: Bearer secret password=hunter2")).toBe(
      "Authorization: [REDACTED] password=[REDACTED]"
    );
  });
});
