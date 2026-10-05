import { describe, expect, it } from "vitest";

import {
  allowedTransitions,
  canTransition,
  transition,
  InvalidExecutionTransitionError,
  type ExecutionState,
} from "./execution-state";

describe("Agent Office execution state", () => {
  it("accepts valid transitions", () => {
    expect(transition("BACKLOG", "ARCHITECT")).toBe("ARCHITECT");
    expect(transition("ARCHITECT", "PLAN_READY")).toBe("PLAN_READY");
    expect(transition("PLAN_READY", "HUMAN_APPROVAL_REQUIRED")).toBe(
      "HUMAN_APPROVAL_REQUIRED",
    );
    expect(transition("HUMAN_APPROVAL_REQUIRED", "BUILDING")).toBe("BUILDING");
    expect(transition("BUILDING", "VALIDATING")).toBe("VALIDATING");
    expect(transition("VALIDATING", "REVIEWING")).toBe("REVIEWING");
    expect(transition("REVIEWING", "READY_FOR_MERGE")).toBe(
      "READY_FOR_MERGE",
    );
    expect(transition("READY_FOR_MERGE", "MERGED")).toBe("MERGED");
  });

  it("rejects invalid transitions", () => {
    expect(() => transition("BACKLOG", "MERGED")).toThrow(
      InvalidExecutionTransitionError,
    );
    expect(() => transition("MERGED", "BUILDING")).toThrow(
      InvalidExecutionTransitionError,
    );
    expect(canTransition("REVIEWING", "BUILDING")).toBe(false);
  });

  it("exposes deterministic next states", () => {
    const state: ExecutionState = "CHANGES_REQUIRED";
    expect(allowedTransitions(state)).toEqual([
      "BUILDING",
      "ARCHITECT",
      "BLOCKED",
      "FAILED_RECOVERY",
    ]);
  });
});
