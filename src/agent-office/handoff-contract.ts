export type RiskClass = "C0" | "C1" | "C2" | "C3";

export interface TaskReference {
  issue: string;
  title: string;
  riskClass: RiskClass;
}

export interface ArchitectHandoff {
  kind: "ARCHITECT_HANDOFF";
  task: TaskReference;
  acceptanceCriteria: readonly string[];
  sourceOfTruth: readonly string[];
  implementationPlan: readonly string[];
  expectedFiles: readonly string[];
  doNotChange: readonly string[];
  impact: {
    db: boolean;
    auth: boolean;
    tenant: boolean;
    booking: boolean;
  };
  testPlan: readonly string[];
  risks: readonly string[];
  openQuestions: readonly string[];
  humanApprovalRequired: boolean;
}

export interface BuilderReport {
  kind: "BUILDER_REPORT";
  task: TaskReference;
  implementedFiles: readonly string[];
  testsAndChecks: readonly string[];
  migrationImpact: string;
  securityTenantBookingImpact: string;
  deviations: readonly string[];
  knownLimitations: readonly string[];
}

export type ReviewerVerdict = "PASS" | "CHANGES_REQUIRED" | "BLOCKED";

export interface ReviewerReport {
  kind: "REVIEWER_REPORT";
  task: TaskReference;
  verdict: ReviewerVerdict;
  blockers: readonly string[];
  requirementCoverage: readonly string[];
  securityStatus: string;
  tenantIsolationStatus: string;
  testStatus: string;
  scopeDrift: readonly string[];
  recommendation: string;
}

export type AgentOfficeHandoff =
  | ArchitectHandoff
  | BuilderReport
  | ReviewerReport;

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function validateTaskReference(
  value: unknown,
): value is TaskReference {
  if (!value || typeof value !== "object") return false;

  const task = value as Partial<TaskReference>;
  return (
    nonEmptyString(task.issue) &&
    nonEmptyString(task.title) &&
    typeof task.riskClass === "string" &&
    ["C0", "C1", "C2", "C3"].includes(task.riskClass)
  );
}

export function validateArchitectHandoff(
  value: unknown,
): value is ArchitectHandoff {
  if (!value || typeof value !== "object") return false;

  const handoff = value as Partial<ArchitectHandoff>;
  return (
    handoff.kind === "ARCHITECT_HANDOFF" &&
    validateTaskReference(handoff.task) &&
    Array.isArray(handoff.acceptanceCriteria) &&
    Array.isArray(handoff.sourceOfTruth) &&
    Array.isArray(handoff.implementationPlan) &&
    Array.isArray(handoff.expectedFiles) &&
    Array.isArray(handoff.doNotChange) &&
    Array.isArray(handoff.testPlan) &&
    Array.isArray(handoff.risks) &&
    Array.isArray(handoff.openQuestions) &&
    typeof handoff.humanApprovalRequired === "boolean" &&
    !!handoff.impact &&
    typeof handoff.impact === "object" &&
    typeof handoff.impact.db === "boolean" &&
    typeof handoff.impact.auth === "boolean" &&
    typeof handoff.impact.tenant === "boolean" &&
    typeof handoff.impact.booking === "boolean"
  );
}

export function validateBuilderReport(
  value: unknown,
): value is BuilderReport {
  if (!value || typeof value !== "object") return false;

  const report = value as Partial<BuilderReport>;
  return (
    report.kind === "BUILDER_REPORT" &&
    validateTaskReference(report.task) &&
    Array.isArray(report.implementedFiles) &&
    Array.isArray(report.testsAndChecks) &&
    nonEmptyString(report.migrationImpact) &&
    nonEmptyString(report.securityTenantBookingImpact) &&
    Array.isArray(report.deviations) &&
    Array.isArray(report.knownLimitations)
  );
}

export function validateReviewerReport(
  value: unknown,
): value is ReviewerReport {
  if (!value || typeof value !== "object") return false;

  const report = value as Partial<ReviewerReport>;
  return (
    report.kind === "REVIEWER_REPORT" &&
    validateTaskReference(report.task) &&
    ["PASS", "CHANGES_REQUIRED", "BLOCKED"].includes(report.verdict ?? "") &&
    Array.isArray(report.blockers) &&
    Array.isArray(report.requirementCoverage) &&
    nonEmptyString(report.securityStatus) &&
    nonEmptyString(report.tenantIsolationStatus) &&
    nonEmptyString(report.testStatus) &&
    Array.isArray(report.scopeDrift) &&
    nonEmptyString(report.recommendation)
  );
}

export function validateHandoff(
  value: unknown,
): value is AgentOfficeHandoff {
  if (!value || typeof value !== "object") return false;

  switch ((value as { kind?: string }).kind) {
    case "ARCHITECT_HANDOFF":
      return validateArchitectHandoff(value);
    case "BUILDER_REPORT":
      return validateBuilderReport(value);
    case "REVIEWER_REPORT":
      return validateReviewerReport(value);
    default:
      return false;
  }
}
