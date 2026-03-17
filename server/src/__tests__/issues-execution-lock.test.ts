import { describe, expect, it } from "vitest";
import { clearExecutionLockFields } from "../services/issues.js";

// ─── Unit tests for clearExecutionLockFields ───────────────────────────────
//
// Regression coverage for the stale execution lock bug:
//   - release() was only clearing checkoutRunId, leaving executionRunId,
//     executionLockedAt, and executionAgentNameKey intact.
//   - PATCH update path had the same gap on status change and assignee change.
//   - Orphaned execution lock fields permanently blocked subsequent checkouts
//     (issues SHI-66, SHI-68 in production, upstream #1007 / #1015 / #1033).
//
// These tests ensure all four lock fields are always cleared atomically.

describe("clearExecutionLockFields", () => {
  it("returns null for all four execution lock fields", () => {
    const fields = clearExecutionLockFields();
    expect(fields.checkoutRunId).toBeNull();
    expect(fields.executionRunId).toBeNull();
    expect(fields.executionLockedAt).toBeNull();
    expect(fields.executionAgentNameKey).toBeNull();
  });

  it("returns exactly the four lock fields and nothing else", () => {
    const fields = clearExecutionLockFields();
    expect(Object.keys(fields).sort()).toEqual([
      "checkoutRunId",
      "executionAgentNameKey",
      "executionLockedAt",
      "executionRunId",
    ]);
  });

  it("is safe to spread into a patch object", () => {
    const patch: Record<string, unknown> = { status: "todo", assigneeAgentId: null };
    Object.assign(patch, clearExecutionLockFields());
    expect(patch).toEqual({
      status: "todo",
      assigneeAgentId: null,
      checkoutRunId: null,
      executionRunId: null,
      executionLockedAt: null,
      executionAgentNameKey: null,
    });
  });

  it("overwrites existing non-null lock values when spread", () => {
    const patch: Record<string, unknown> = {
      checkoutRunId: "run-abc",
      executionRunId: "run-abc",
      executionLockedAt: new Date("2026-03-17T00:00:00Z"),
      executionAgentNameKey: "claude-opus-planner",
    };
    Object.assign(patch, clearExecutionLockFields());
    expect(patch.checkoutRunId).toBeNull();
    expect(patch.executionRunId).toBeNull();
    expect(patch.executionLockedAt).toBeNull();
    expect(patch.executionAgentNameKey).toBeNull();
  });

  it("is idempotent — spreading twice produces the same result", () => {
    const patch: Record<string, unknown> = {};
    Object.assign(patch, clearExecutionLockFields());
    Object.assign(patch, clearExecutionLockFields());
    expect(patch.checkoutRunId).toBeNull();
    expect(patch.executionRunId).toBeNull();
    expect(patch.executionLockedAt).toBeNull();
    expect(patch.executionAgentNameKey).toBeNull();
  });
});

// ─── Scenario coverage (pure logic, no DB) ────────────────────────────────
//
// These tests document the conditions under which lock fields must be cleared,
// matching the three call sites in issues.ts.

describe("execution lock clearing — call site scenarios", () => {
  // Simulates: release() path
  it("release: lock fields are included in the release patch", () => {
    const releasePatch = {
      status: "todo" as const,
      assigneeAgentId: null,
      ...clearExecutionLockFields(),
      updatedAt: new Date(),
    };
    expect(releasePatch.checkoutRunId).toBeNull();
    expect(releasePatch.executionRunId).toBeNull();
    expect(releasePatch.executionLockedAt).toBeNull();
    expect(releasePatch.executionAgentNameKey).toBeNull();
    expect(releasePatch.status).toBe("todo");
    expect(releasePatch.assigneeAgentId).toBeNull();
  });

  // Simulates: PATCH path — status moves away from in_progress
  it("status change: clearing fires when new status is not in_progress", () => {
    const statuses = ["todo", "done", "cancelled"] as const;
    for (const status of statuses) {
      const patch: Record<string, unknown> = { status };
      if (status !== "in_progress") {
        Object.assign(patch, clearExecutionLockFields());
      }
      expect(patch.checkoutRunId).toBeNull();
      expect(patch.executionRunId).toBeNull();
    }
  });

  // Simulates: PATCH path — status stays in_progress (should NOT clear)
  it("status change: lock fields are NOT cleared when status stays in_progress", () => {
    const patch: Record<string, unknown> = {
      status: "in_progress",
      executionRunId: "run-abc",
    };
    const newStatus = "in_progress";
    if (newStatus !== "in_progress") {
      Object.assign(patch, clearExecutionLockFields());
    }
    expect(patch.executionRunId).toBe("run-abc"); // unchanged
  });

  // Simulates: PATCH path — assignee change
  it("assignee change: clearing fires when assigneeAgentId changes", () => {
    const existing = { assigneeAgentId: "agent-A", assigneeUserId: null };
    const update = { assigneeAgentId: "agent-B", assigneeUserId: undefined };
    const patch: Record<string, unknown> = { ...update };

    const assigneeChanged =
      (update.assigneeAgentId !== undefined && update.assigneeAgentId !== existing.assigneeAgentId) ||
      (update.assigneeUserId !== undefined && update.assigneeUserId !== existing.assigneeUserId);

    if (assigneeChanged) {
      Object.assign(patch, clearExecutionLockFields());
    }

    expect(assigneeChanged).toBe(true);
    expect(patch.checkoutRunId).toBeNull();
    expect(patch.executionRunId).toBeNull();
  });

  // Simulates: PATCH path — assignee unchanged (should NOT clear)
  it("assignee change: lock fields are NOT cleared when assignee is unchanged", () => {
    const existing = { assigneeAgentId: "agent-A", assigneeUserId: null };
    const update = { assigneeAgentId: "agent-A", assigneeUserId: undefined };
    const patch: Record<string, unknown> = { executionRunId: "run-abc" };

    const assigneeChanged =
      (update.assigneeAgentId !== undefined && update.assigneeAgentId !== existing.assigneeAgentId) ||
      (update.assigneeUserId !== undefined && update.assigneeUserId !== existing.assigneeUserId);

    if (assigneeChanged) {
      Object.assign(patch, clearExecutionLockFields());
    }

    expect(assigneeChanged).toBe(false);
    expect(patch.executionRunId).toBe("run-abc"); // unchanged
  });
});
