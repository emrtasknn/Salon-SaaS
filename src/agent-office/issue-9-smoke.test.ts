import { describe, expect, it } from "vitest";

import {
  InvalidExecutionTransitionError,
  transition,
} from "./execution-state";
import {
  validateArchitectHandoff,
  validateBuilderReport,
  validateReviewerReport,
} from "./handoff-contract";

describe("Issue #9 Agent Office smoke test", () => {
  it("accepts the Builder shortcut execution path", () => {
    expect(transition("BACKLOG", "BUILDING")).toBe("BUILDING");
    expect(transition("BUILDING", "VALIDATING")).toBe("VALIDATING");
    expect(transition("VALIDATING", "REVIEWING")).toBe("REVIEWING");
    expect(transition("REVIEWING", "READY_FOR_MERGE")).toBe("READY_FOR_MERGE");
  });

  it("rejects an invalid execution transition", () => {
    expect(() => transition("BACKLOG", "MERGED")).toThrow(
      InvalidExecutionTransitionError,
    );
  });

  it("consumes structured Architect, Builder, and Reviewer handoffs", () => {
    const task = {
      issue: "#9",
      title: "Agent Office execution-loop Builder smoke test",
      riskClass: "C0" as const,
    };

    expect(
      validateArchitectHandoff({
        kind: "ARCHITECT_HANDOFF",
        task,
        acceptanceCriteria: ["smoke path is auditable"],
        sourceOfTruth: ["Issue #8 execution-loop contracts"],
        implementationPlan: ["exercise existing state and handoff contracts"],
        expectedFiles: ["src/agent-office/issue-9-smoke.test.ts"],
        doNotChange: ["product/domain behavior", "production systems"],
        impact: { db: false, auth: false, tenant: false, booking: false },
        testPlan: ["run npm test"],
        risks: ["none beyond smoke-test coverage"],
        openQuestions: [],
        humanApprovalRequired: false,
      }),
    ).toBe(true);

    expect(
      validateBuilderReport({
        kind: "BUILDER_REPORT",
        task,
        implementedFiles: ["src/agent-office/issue-9-smoke.test.ts"],
        testsAndChecks: ["npm test"],
        migrationImpact: "none",
        securityTenantBookingImpact: "none",
        deviations: [],
        knownLimitations: [],
      }),
    ).toBe(true);

    expect(
      validateReviewerReport({
        kind: "REVIEWER_REPORT",
        task,
        verdict: "PASS",
        blockers: [],
        requirementCoverage: ["Issue #9 smoke criteria"],
        securityStatus: "unchanged",
        tenantIsolationStatus: "unchanged",
        testStatus: "green",
        scopeDrift: [],
        recommendation: "ready for merge",
      }),
    ).toBe(true);
  });
});
