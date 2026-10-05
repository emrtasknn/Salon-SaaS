import { describe, expect, it } from "vitest";

import {
  validateArchitectHandoff,
  validateBuilderReport,
  validateHandoff,
  validateReviewerReport,
} from "./handoff-contract";

const task = {
  issue: "#8",
  title: "Agent Office execution loop",
  riskClass: "C3" as const,
};

describe("Agent Office handoff contracts", () => {
  it("validates an Architect handoff", () => {
    expect(
      validateArchitectHandoff({
        kind: "ARCHITECT_HANDOFF",
        task,
        acceptanceCriteria: ["state machine is explicit"],
        sourceOfTruth: ["AGENTS.md"],
        implementationPlan: ["define state transitions"],
        expectedFiles: ["src/agent-office/execution-state.ts"],
        doNotChange: ["prisma/**"],
        impact: { db: false, auth: false, tenant: false, booking: false },
        testPlan: ["unit tests"],
        risks: ["state drift"],
        openQuestions: [],
        humanApprovalRequired: true,
      }),
    ).toBe(true);
  });

  it("rejects incomplete handoffs", () => {
    expect(validateHandoff({ kind: "ARCHITECT_HANDOFF", task })).toBe(false);
    expect(
      validateBuilderReport({
        kind: "BUILDER_REPORT",
        task,
        implementedFiles: [],
      }),
    ).toBe(false);
  });

  it("validates Builder and Reviewer reports", () => {
    expect(
      validateBuilderReport({
        kind: "BUILDER_REPORT",
        task,
        implementedFiles: [],
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
        requirementCoverage: ["all"],
        securityStatus: "unchanged",
        tenantIsolationStatus: "unchanged",
        testStatus: "green",
        scopeDrift: [],
        recommendation: "ready for merge",
      }),
    ).toBe(true);
  });
});
