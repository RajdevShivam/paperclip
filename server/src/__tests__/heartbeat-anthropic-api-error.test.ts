import { describe, expect, it } from "vitest";

// ─── Regression tests for Anthropic API 500 error handling ────────────────────
//
// Observed in production (2026-03-17):
//   Run b182e6a2 and 00a82b6a both failed with:
//     "Claude run failed: subtype=success: API Error: 500
//      {"type":"error","error":{"type":"api_error","message":"Internal server error"},...}"
//
// Root cause:
//   1. Anthropic's API returned a transient 500 on the first run.
//   2. Despite the failure, Claude CLI emitted a `session_id` in its result JSON
//      and exited with code 1. Paperclip saved that session as sessionIdAfter.
//   3. The next run resumed the same session and hit another 500 — the bad
//      session was being re-used in a retry loop.
//
// Fix (isClaudeApiServerError + clearSession=true):
//   When the parsed result contains "API Error: 5XX", Paperclip now:
//   - Sets errorCode = "anthropic_api_error" (distinct from generic "adapter_failed")
//   - Sets clearSession = true so the next run starts with a fresh session
//
// Source: packages/adapters/claude-local/src/server/parse.ts
//   ANTHROPIC_SERVER_ERROR_RE = /API\s+Error:\s+5\d\d/i
//   isClaudeApiServerError(parsed): checks result text + errors array

// ─────────────────────────────────────────────────────────────────────────────
// Mirror the detection function as a pure helper for testing.
// ─────────────────────────────────────────────────────────────────────────────

const ANTHROPIC_SERVER_ERROR_RE = /API\s+Error:\s+5\d\d/i;

function isClaudeApiServerError(parsed: Record<string, unknown> | null | undefined): boolean {
  if (!parsed) return false;
  const result = typeof parsed.result === "string" ? parsed.result.trim() : "";
  const errors = Array.isArray(parsed.errors)
    ? (parsed.errors as unknown[]).flatMap((e) => {
        if (typeof e === "string") return [e];
        if (typeof e === "object" && e !== null) {
          const obj = e as Record<string, unknown>;
          return [obj.message ?? obj.error ?? obj.code ?? ""]
            .map(String)
            .filter(Boolean);
        }
        return [];
      })
    : [];
  const allMessages = [result, ...errors].map((m) => m.trim()).filter(Boolean);
  return allMessages.some((msg) => ANTHROPIC_SERVER_ERROR_RE.test(msg));
}

// ─────────────────────────────────────────────────────────────────────────────
// Detection: true cases
// ─────────────────────────────────────────────────────────────────────────────

describe("isClaudeApiServerError — true cases", () => {
  it("detects Anthropic 500 from result field (exact production payload)", () => {
    const parsed = {
      type: "result",
      subtype: "success",
      is_error: true,
      result:
        'API Error: 500 {"type":"error","error":{"type":"api_error","message":"Internal server error"},"request_id":"req_011CZ9DkNjPPazJwsdxMkHYp"}',
    };
    expect(isClaudeApiServerError(parsed)).toBe(true);
  });

  it("detects Anthropic 503 from result field", () => {
    expect(
      isClaudeApiServerError({ result: "API Error: 503 Service Unavailable" }),
    ).toBe(true);
  });

  it("detects Anthropic 502 from result field", () => {
    expect(
      isClaudeApiServerError({ result: "API Error: 502 Bad Gateway" }),
    ).toBe(true);
  });

  it("detects error in errors array (string entry)", () => {
    expect(
      isClaudeApiServerError({
        result: "",
        errors: ["API Error: 500 Internal server error"],
      }),
    ).toBe(true);
  });

  it("detects error in errors array (object entry with message field)", () => {
    expect(
      isClaudeApiServerError({
        errors: [{ message: "API Error: 500 Internal server error" }],
      }),
    ).toBe(true);
  });

  it("is case-insensitive — lowercase 'api error'", () => {
    expect(
      isClaudeApiServerError({ result: "api error: 500 something went wrong" }),
    ).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Detection: false cases
// ─────────────────────────────────────────────────────────────────────────────

describe("isClaudeApiServerError — false cases", () => {
  it("returns false for null", () => {
    expect(isClaudeApiServerError(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isClaudeApiServerError(undefined)).toBe(false);
  });

  it("returns false for a normal success result", () => {
    expect(
      isClaudeApiServerError({
        subtype: "success",
        result: "Task completed. SHI-69 is done.",
      }),
    ).toBe(false);
  });

  it("returns false for a 4xx client error (not a server error)", () => {
    expect(
      isClaudeApiServerError({ result: "API Error: 401 Unauthorized" }),
    ).toBe(false);
  });

  it("returns false for API Error: 400", () => {
    expect(
      isClaudeApiServerError({ result: "API Error: 400 Bad Request" }),
    ).toBe(false);
  });

  it("returns false when 'API Error' mentions 5xx in non-error context", () => {
    // Number in a result text that happens to contain '5' followed by digits
    expect(
      isClaudeApiServerError({ result: "Processed 500 items successfully" }),
    ).toBe(false);
  });

  it("returns false for empty result and no errors", () => {
    expect(isClaudeApiServerError({ result: "", subtype: "success" })).toBe(false);
  });

  it("returns false for a max-turns error", () => {
    expect(
      isClaudeApiServerError({ subtype: "error_max_turns", result: "" }),
    ).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Outcome: when API server error is detected, clearSession must be true
// ─────────────────────────────────────────────────────────────────────────────

describe("clearSession behavior on Anthropic API server error", () => {
  function shouldClearSession(opts: {
    isMaxTurns: boolean;
    isApiServerError: boolean;
    clearSessionOnMissingSession: boolean;
    resolvedSessionId: string | null;
  }): boolean {
    return (
      opts.isMaxTurns ||
      opts.isApiServerError ||
      (opts.clearSessionOnMissingSession && !opts.resolvedSessionId)
    );
  }

  it("clears session when API server error is detected", () => {
    expect(
      shouldClearSession({
        isMaxTurns: false,
        isApiServerError: true,
        clearSessionOnMissingSession: false,
        resolvedSessionId: "8b7fb786-155d-47c5-91c1-4cca374592a2",
      }),
    ).toBe(true);
  });

  it("does NOT clear session for a normal successful run", () => {
    expect(
      shouldClearSession({
        isMaxTurns: false,
        isApiServerError: false,
        clearSessionOnMissingSession: false,
        resolvedSessionId: "8b7fb786-155d-47c5-91c1-4cca374592a2",
      }),
    ).toBe(false);
  });

  it("clears session for max-turns independently of API error", () => {
    expect(
      shouldClearSession({
        isMaxTurns: true,
        isApiServerError: false,
        clearSessionOnMissingSession: false,
        resolvedSessionId: "some-session",
      }),
    ).toBe(true);
  });

  it("clears session when both max-turns and API error are true", () => {
    expect(
      shouldClearSession({
        isMaxTurns: true,
        isApiServerError: true,
        clearSessionOnMissingSession: false,
        resolvedSessionId: "some-session",
      }),
    ).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// errorCode: "anthropic_api_error" vs "adapter_failed"
// ─────────────────────────────────────────────────────────────────────────────

describe("errorCode assignment for Anthropic API server errors", () => {
  function resolveErrorCode(opts: {
    requiresLogin: boolean;
    isApiServerError: boolean;
  }): string | null {
    if (opts.requiresLogin) return "claude_auth_required";
    if (opts.isApiServerError) return "anthropic_api_error";
    return null;
  }

  it("sets errorCode='anthropic_api_error' for a 500 result", () => {
    expect(
      resolveErrorCode({ requiresLogin: false, isApiServerError: true }),
    ).toBe("anthropic_api_error");
  });

  it("login takes precedence over API error", () => {
    expect(
      resolveErrorCode({ requiresLogin: true, isApiServerError: true }),
    ).toBe("claude_auth_required");
  });

  it("returns null for normal runs (no specific error)", () => {
    expect(
      resolveErrorCode({ requiresLogin: false, isApiServerError: false }),
    ).toBeNull();
  });
});
