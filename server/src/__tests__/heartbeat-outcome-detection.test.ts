import { describe, expect, it } from "vitest";

// ─── Regression tests for silent-success / permission-block detection (#1117) ──
//
// Before this fix, an agent that exited with code 0 but was blocked by missing
// permissions (e.g. dangerouslySkipPermissions not active) was recorded as
// "succeeded". The fix inspects stdoutExcerpt for permission-block phrases and
// re-classifies the outcome as "failed" when any are found.
//
// This file mirrors the detection logic from heartbeat.ts as a pure helper so
// the exact phrase list and regex are tested in isolation without DB dependencies.

const permissionBlockPhrases: (string | RegExp)[] = [
  "unable to proceed",
  "require user approval",
  "requires user approval",
  "cannot proceed",
  "permission denied",
  "bash commands require",
  /need.*approval/,
];

function isPermissionBlockedOutput(stdout: string): boolean {
  const lower = stdout.toLowerCase();
  return permissionBlockPhrases.some((phrase) =>
    typeof phrase === "string" ? lower.includes(phrase) : phrase.test(lower),
  );
}

describe("isPermissionBlockedOutput — true cases", () => {
  it("detects 'bash commands require' phrase", () => {
    expect(
      isPermissionBlockedOutput(
        "I'm unable to proceed because my bash commands require user approval",
      ),
    ).toBe(true);
  });

  it("detects 'cannot proceed' phrase", () => {
    expect(
      isPermissionBlockedOutput("I cannot proceed without permission"),
    ).toBe(true);
  });

  it("detects 'requires user approval' phrase", () => {
    expect(
      isPermissionBlockedOutput(
        "This requires user approval before I can continue",
      ),
    ).toBe(true);
  });

  it("detects standalone 'bash commands require' phrase", () => {
    expect(isPermissionBlockedOutput("bash commands require approval")).toBe(
      true,
    );
  });

  it("detects 'unable to proceed' phrase", () => {
    expect(isPermissionBlockedOutput("I am unable to proceed here")).toBe(true);
  });

  it("detects 'require user approval' phrase (singular form)", () => {
    expect(isPermissionBlockedOutput("these actions require user approval")).toBe(true);
  });

  it("detects 'need.*approval' regex pattern", () => {
    expect(isPermissionBlockedOutput("I need your approval to continue")).toBe(true);
  });

  it("detects 'permission denied' phrase", () => {
    expect(isPermissionBlockedOutput("permission denied when running bash")).toBe(true);
  });

  it("is case-insensitive — uppercase phrase", () => {
    expect(isPermissionBlockedOutput("BASH COMMANDS REQUIRE APPROVAL")).toBe(true);
  });

  it("is case-insensitive — mixed-case phrase", () => {
    expect(isPermissionBlockedOutput("Cannot Proceed without user input")).toBe(true);
  });
});

describe("isPermissionBlockedOutput — false cases", () => {
  it("returns false for empty string", () => {
    expect(isPermissionBlockedOutput("")).toBe(false);
  });

  it("returns false for generic success output", () => {
    expect(isPermissionBlockedOutput("Task completed successfully")).toBe(false);
  });

  it("returns false for heartbeat status message", () => {
    expect(isPermissionBlockedOutput("I ran the heartbeat check")).toBe(false);
  });

  it("returns false for 'unable' without permission context", () => {
    // 'unable to find' should not match 'unable to proceed'
    expect(isPermissionBlockedOutput("Unable to find the file")).toBe(false);
  });

  it("returns false for unrelated tool output", () => {
    expect(
      isPermissionBlockedOutput(
        "Running npm install... done. 42 packages installed.",
      ),
    ).toBe(false);
  });

  it("returns false for partial phrase match that lacks key word", () => {
    // 'require' alone without 'user approval' should not trigger
    expect(isPermissionBlockedOutput("these steps require careful attention")).toBe(false);
  });
});
