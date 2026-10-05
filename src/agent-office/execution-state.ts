export const EXECUTION_STATES = [
  "BACKLOG",
  "ARCHITECT",
  "PLAN_READY",
  "HUMAN_APPROVAL_REQUIRED",
  "BUILDING",
  "VALIDATING",
  "REVIEWING",
  "CHANGES_REQUIRED",
  "BLOCKED",
  "READY_FOR_MERGE",
  "MERGED",
  "FAILED_RECOVERY",
] as const;

export type ExecutionState = (typeof EXECUTION_STATES)[number];

const transitions: Record<ExecutionState, readonly ExecutionState[]> = {
  BACKLOG: ["ARCHITECT", "BUILDING"],
  ARCHITECT: ["PLAN_READY", "BLOCKED", "FAILED_RECOVERY"],
  PLAN_READY: ["HUMAN_APPROVAL_REQUIRED", "BUILDING", "BLOCKED"],
  HUMAN_APPROVAL_REQUIRED: ["BUILDING", "BLOCKED"],
  BUILDING: ["VALIDATING", "CHANGES_REQUIRED", "BLOCKED", "FAILED_RECOVERY"],
  VALIDATING: ["REVIEWING", "BUILDING", "BLOCKED", "FAILED_RECOVERY"],
  REVIEWING: ["READY_FOR_MERGE", "CHANGES_REQUIRED", "BLOCKED", "FAILED_RECOVERY"],
  CHANGES_REQUIRED: ["BUILDING", "ARCHITECT", "BLOCKED", "FAILED_RECOVERY"],
  BLOCKED: ["ARCHITECT", "BUILDING", "FAILED_RECOVERY"],
  READY_FOR_MERGE: ["MERGED", "BLOCKED"],
  MERGED: [],
  FAILED_RECOVERY: ["ARCHITECT", "BUILDING", "BLOCKED"],
};

export class InvalidExecutionTransitionError extends Error {
  constructor(from: ExecutionState, to: ExecutionState) {
    super(`Invalid Agent Office transition: ${from} -> ${to}`);
    this.name = "InvalidExecutionTransitionError";
  }
}

export function canTransition(
  from: ExecutionState,
  to: ExecutionState,
): boolean {
  return transitions[from].includes(to);
}

export function transition(
  from: ExecutionState,
  to: ExecutionState,
): ExecutionState {
  if (!canTransition(from, to)) {
    throw new InvalidExecutionTransitionError(from, to);
  }

  return to;
}

export function allowedTransitions(
  from: ExecutionState,
): readonly ExecutionState[] {
  return transitions[from];
}
