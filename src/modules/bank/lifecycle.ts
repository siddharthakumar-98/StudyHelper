export type QuestionStatus = "draft" | "needs_review" | "active" | "flagged" | "retired";

export type LifecycleAction =
  | "verify_pass"
  | "verify_fail"
  | "mark_duplicate"
  | "flag"
  | "approve"
  | "edit"
  | "reject"
  | "regenerate";

export type Actor = "system" | "student" | "admin";

export type Transition = { to: QuestionStatus; newVersion: boolean };

type TableEntry = Transition & { actors: readonly Actor[] };

/**
 * Complete legal transition table (spec section 4.2). Anything not listed here is illegal.
 * Lookup is keyed by (from, action); the actor must appear in `actors`.
 */
const TRANSITIONS: Record<QuestionStatus, Partial<Record<LifecycleAction, TableEntry>>> = {
  draft: {
    verify_pass: { actors: ["system"], to: "active", newVersion: false },
    verify_fail: { actors: ["system"], to: "needs_review", newVersion: false },
    mark_duplicate: { actors: ["system"], to: "retired", newVersion: false },
    // A killed regenerate can strand a draft that no check will finish; an admin must be able to clear it.
    approve: { actors: ["admin"], to: "active", newVersion: false },
    reject: { actors: ["admin"], to: "retired", newVersion: false },
  },
  active: {
    flag: { actors: ["student", "admin"], to: "flagged", newVersion: false },
    edit: { actors: ["admin"], to: "active", newVersion: true },
    reject: { actors: ["admin"], to: "retired", newVersion: false },
    regenerate: { actors: ["admin"], to: "draft", newVersion: true },
  },
  needs_review: {
    edit: { actors: ["admin"], to: "active", newVersion: true },
    approve: { actors: ["admin"], to: "active", newVersion: false },
    reject: { actors: ["admin"], to: "retired", newVersion: false },
    regenerate: { actors: ["admin"], to: "draft", newVersion: true },
  },
  flagged: {
    edit: { actors: ["admin"], to: "active", newVersion: true },
    approve: { actors: ["admin"], to: "active", newVersion: false },
    reject: { actors: ["admin"], to: "retired", newVersion: false },
    regenerate: { actors: ["admin"], to: "draft", newVersion: true },
  },
  retired: {},
};

export class IllegalTransitionError extends Error {
  readonly from: QuestionStatus;
  readonly action: LifecycleAction;
  readonly actor: Actor;

  constructor(from: QuestionStatus, action: LifecycleAction, actor: Actor, reason: string) {
    super(
      `Illegal question transition: action "${action}" by actor "${actor}" from status "${from}" is not allowed (${reason}).`,
    );
    this.name = "IllegalTransitionError";
    this.from = from;
    this.action = action;
    this.actor = actor;
  }
}

/**
 * Returns the next status and whether a new question version is created.
 * Throws IllegalTransitionError for any (from, action, actor) not in the table.
 */
export function transition(
  from: QuestionStatus,
  action: LifecycleAction,
  actor: Actor,
): Transition {
  const byAction = Object.prototype.hasOwnProperty.call(TRANSITIONS, from)
    ? TRANSITIONS[from]
    : undefined;
  const entry =
    byAction && Object.prototype.hasOwnProperty.call(byAction, action) ? byAction[action] : undefined;

  if (!entry) {
    throw new IllegalTransitionError(from, action, actor, "no such action from this status");
  }
  if (!entry.actors.includes(actor)) {
    throw new IllegalTransitionError(
      from,
      action,
      actor,
      `actor must be one of: ${entry.actors.join(", ")}`,
    );
  }
  return { to: entry.to, newVersion: entry.newVersion };
}
