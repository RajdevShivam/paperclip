import { describe, expect, it } from "vitest";
import { validateWorkspaceCommand } from "../services/workspace-runtime.js";

// ─── Regression tests for validateWorkspaceCommand (#883) ────────────────────
//
// Before this fix, workspace provision commands were passed directly to a shell
// without validation, enabling command injection via semicolons, pipes, backticks,
// logical operators, redirections, subshell syntax, and embedded newlines.
// validateWorkspaceCommand now blocks all of these while allowing legitimate
// provision patterns.

describe("validateWorkspaceCommand — allowed commands", () => {
  it("allows a plain npm install", () => {
    expect(() => validateWorkspaceCommand("npm install")).not.toThrow();
  });

  it("allows a bash script invocation", () => {
    expect(() => validateWorkspaceCommand("bash setup.sh")).not.toThrow();
  });

  it("allows a relative script path with directory prefix", () => {
    expect(() => validateWorkspaceCommand("./scripts/provision.sh")).not.toThrow();
  });

  it("allows ${VAR} env var expansion syntax", () => {
    expect(() => validateWorkspaceCommand("echo ${ISSUE_ID}")).not.toThrow();
  });

  it("allows git branch creation with hyphens", () => {
    expect(() => validateWorkspaceCommand("git checkout -b branch-name")).not.toThrow();
  });

  it("allows a command with underscores and dots", () => {
    expect(() => validateWorkspaceCommand("./run_setup.sh")).not.toThrow();
  });

  it("allows multiple args with flags", () => {
    expect(() => validateWorkspaceCommand("npm run build --production")).not.toThrow();
  });
});

describe("validateWorkspaceCommand — blocked injection patterns", () => {
  it("blocks semicolon injection", () => {
    expect(() => validateWorkspaceCommand("rm -rf /; echo pwned")).toThrow();
  });

  it("blocks pipe chaining", () => {
    expect(() => validateWorkspaceCommand("cmd1 | cmd2")).toThrow();
  });

  it("blocks backtick subshell", () => {
    expect(() => validateWorkspaceCommand("cmd`injection`")).toThrow();
  });

  it("blocks && logical operator", () => {
    expect(() => validateWorkspaceCommand("cmd && bad")).toThrow();
  });

  it("blocks || logical operator", () => {
    expect(() => validateWorkspaceCommand("cmd || bad")).toThrow();
  });

  it("blocks output redirection", () => {
    expect(() => validateWorkspaceCommand("cmd > /etc/passwd")).toThrow();
  });

  it("blocks $() subshell syntax", () => {
    expect(() => validateWorkspaceCommand("$(malicious)")).toThrow();
  });

  it("blocks multi-line commands with embedded newline", () => {
    expect(() => validateWorkspaceCommand("npm install\nrm -rf /")).toThrow();
  });

  it("throws with a descriptive error message", () => {
    expect(() => validateWorkspaceCommand("rm -rf /; echo pwned")).toThrowError(
      /disallowed characters/,
    );
  });
});

describe("validateWorkspaceCommand — edge cases", () => {
  it("allows an empty string", () => {
    expect(() => validateWorkspaceCommand("")).not.toThrow();
  });

  it("allows a whitespace-only string", () => {
    expect(() => validateWorkspaceCommand("   ")).not.toThrow();
  });

  it("allows a single dot path segment", () => {
    expect(() => validateWorkspaceCommand("./run.sh")).not.toThrow();
  });

  it("allows nested ${} env var references", () => {
    expect(() => validateWorkspaceCommand("bash ${SCRIPT_PATH}")).not.toThrow();
  });
});
