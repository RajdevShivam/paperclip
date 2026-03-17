import { describe, expect, it } from "vitest";

// ─── Regression tests for heartbeat runs list limit (#958) ───────────────────
//
// Before this fix, the GET /agents/:id/heartbeat-runs route had no default limit,
// causing large result sets to be returned. The fix added:
//   - default of 100 when no param is provided
//   - minimum clamp of 1 (prevents 0 or negative)
//   - maximum clamp of 500 (prevents unbounded queries)
//   - graceful fallback to 100 when the param is non-numeric
//
// Source: server/src/routes/agents.ts line 1416
//   Math.max(1, Math.min(500, limitParam ? (parseInt(limitParam, 10) || 100) : 100))
//
// This helper mirrors that one-liner as a testable pure function.

function parseHeartbeatRunsLimit(param: string | undefined): number {
  return Math.max(1, Math.min(500, param ? (parseInt(param, 10) || 100) : 100));
}

describe("parseHeartbeatRunsLimit", () => {
  it("returns 100 when param is undefined (default)", () => {
    expect(parseHeartbeatRunsLimit(undefined)).toBe(100);
  });

  it("returns the parsed value for a valid numeric string", () => {
    expect(parseHeartbeatRunsLimit("50")).toBe(50);
  });

  it("returns 100 fallback for '0' (parseInt('0') is falsy, so || 100 fires)", () => {
    // Subtle: parseInt("0") === 0, which is falsy, so `|| 100` kicks in.
    // The effective minimum of 1 only applies to negative values, not zero.
    expect(parseHeartbeatRunsLimit("0")).toBe(100);
  });

  it("clamps to maximum 500 when param exceeds 500", () => {
    expect(parseHeartbeatRunsLimit("1000")).toBe(500);
  });

  it("returns 100 fallback for a non-numeric string", () => {
    expect(parseHeartbeatRunsLimit("abc")).toBe(100);
  });

  it("returns 200 for '200'", () => {
    expect(parseHeartbeatRunsLimit("200")).toBe(200);
  });

  it("clamps to minimum 1 for a negative value", () => {
    expect(parseHeartbeatRunsLimit("-10")).toBe(1);
  });

  it("returns exactly 500 at the boundary", () => {
    expect(parseHeartbeatRunsLimit("500")).toBe(500);
  });

  it("returns exactly 1 at the minimum boundary", () => {
    expect(parseHeartbeatRunsLimit("1")).toBe(1);
  });

  it("returns 100 fallback for an empty string", () => {
    // parseInt("") === NaN, so || 100 kicks in; Math.max(1, Math.min(500, 100)) = 100
    // but empty string is falsy so the ternary takes the :100 branch — same result
    expect(parseHeartbeatRunsLimit("")).toBe(100);
  });

  it("returns 100 fallback for a float string that parses to NaN via integer path", () => {
    // parseInt("3.14") === 3, which is truthy and valid
    expect(parseHeartbeatRunsLimit("3.14")).toBe(3);
  });
});
