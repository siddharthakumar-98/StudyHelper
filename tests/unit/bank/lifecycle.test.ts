import { describe, expect, it } from "vitest";
import {
  IllegalTransitionError,
  transition,
  type Actor,
  type LifecycleAction,
  type QuestionStatus,
} from "@/modules/bank/lifecycle";

type LegalRow = {
  from: QuestionStatus;
  action: LifecycleAction;
  actor: Actor;
  to: QuestionStatus;
  newVersion: boolean;
};

// Mirrors the complete legal transition table (spec section 4.2).
const LEGAL: LegalRow[] = [
  { from: "draft", action: "verify_pass", actor: "system", to: "active", newVersion: false },
  { from: "draft", action: "verify_fail", actor: "system", to: "needs_review", newVersion: false },
  { from: "draft", action: "mark_duplicate", actor: "system", to: "retired", newVersion: false },
  { from: "active", action: "flag", actor: "student", to: "flagged", newVersion: false },
  { from: "active", action: "flag", actor: "admin", to: "flagged", newVersion: false },
  { from: "active", action: "edit", actor: "admin", to: "active", newVersion: true },
  { from: "needs_review", action: "edit", actor: "admin", to: "active", newVersion: true },
  { from: "flagged", action: "edit", actor: "admin", to: "active", newVersion: true },
  { from: "needs_review", action: "approve", actor: "admin", to: "active", newVersion: false },
  { from: "flagged", action: "approve", actor: "admin", to: "active", newVersion: false },
  { from: "active", action: "reject", actor: "admin", to: "retired", newVersion: false },
  { from: "needs_review", action: "reject", actor: "admin", to: "retired", newVersion: false },
  { from: "flagged", action: "reject", actor: "admin", to: "retired", newVersion: false },
  { from: "active", action: "regenerate", actor: "admin", to: "draft", newVersion: true },
  { from: "needs_review", action: "regenerate", actor: "admin", to: "draft", newVersion: true },
  { from: "flagged", action: "regenerate", actor: "admin", to: "draft", newVersion: true },
];

const STATUSES: QuestionStatus[] = ["draft", "needs_review", "active", "flagged", "retired"];
const ACTIONS: LifecycleAction[] = [
  "verify_pass",
  "verify_fail",
  "mark_duplicate",
  "flag",
  "approve",
  "edit",
  "reject",
  "regenerate",
];
const ACTORS: Actor[] = ["system", "student", "admin"];

function isLegal(from: QuestionStatus, action: LifecycleAction, actor: Actor): boolean {
  return LEGAL.some((r) => r.from === from && r.action === action && r.actor === actor);
}

describe("transition: legal rows", () => {
  it.each(LEGAL)(
    "$from + $action by $actor -> $to (newVersion=$newVersion)",
    ({ from, action, actor, to, newVersion }) => {
      expect(transition(from, action, actor)).toEqual({ to, newVersion });
    },
  );
});

describe("transition: illegal rows", () => {
  it.each([
    ["student approve on draft", "draft", "approve", "student"],
    ["draft approve by admin", "draft", "approve", "admin"],
    ["retired edit by admin", "retired", "edit", "admin"],
    ["flagged flag by admin", "flagged", "flag", "admin"],
    ["flagged flag by student", "flagged", "flag", "student"],
  ] as const)("throws for %s", (_label, from, action, actor) => {
    expect(() => transition(from, action, actor)).toThrow(IllegalTransitionError);
  });

  it("system cannot flag an active question", () => {
    expect(() => transition("active", "flag", "system")).toThrow(IllegalTransitionError);
  });

  it("student cannot edit", () => {
    expect(() => transition("active", "edit", "student")).toThrow(IllegalTransitionError);
    expect(() => transition("flagged", "edit", "student")).toThrow(IllegalTransitionError);
  });

  it("student cannot reject", () => {
    expect(() => transition("active", "reject", "student")).toThrow(IllegalTransitionError);
  });

  it("student cannot regenerate", () => {
    expect(() => transition("active", "regenerate", "student")).toThrow(IllegalTransitionError);
  });

  it("system cannot approve, edit, reject or regenerate", () => {
    for (const action of ["approve", "edit", "reject", "regenerate"] as const) {
      expect(() => transition("needs_review", action, "system")).toThrow(IllegalTransitionError);
    }
  });

  it("nothing leaves retired", () => {
    for (const action of ACTIONS) {
      for (const actor of ACTORS) {
        expect(() => transition("retired", action, actor)).toThrow(IllegalTransitionError);
      }
    }
  });

  it("every from/action/actor combination not in the table throws", () => {
    const illegal: [QuestionStatus, LifecycleAction, Actor][] = [];
    for (const from of STATUSES) {
      for (const action of ACTIONS) {
        for (const actor of ACTORS) {
          if (!isLegal(from, action, actor)) illegal.push([from, action, actor]);
        }
      }
    }
    expect(illegal.length).toBe(STATUSES.length * ACTIONS.length * ACTORS.length - LEGAL.length);

    for (const [from, action, actor] of illegal) {
      expect(() => transition(from, action, actor), `${from}/${action}/${actor}`).toThrow(
        IllegalTransitionError,
      );
    }
  });
});

describe("IllegalTransitionError", () => {
  it("is an Error subclass with a helpful message naming from, action and actor", () => {
    let caught: unknown;
    try {
      transition("draft", "approve", "student");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(IllegalTransitionError);
    expect(caught).toBeInstanceOf(Error);
    const message = (caught as Error).message;
    expect(message).toContain("draft");
    expect(message).toContain("approve");
    expect(message).toContain("student");
  });

  it("names the actor when the action exists but the actor is not allowed", () => {
    expect(() => transition("active", "edit", "student")).toThrow(/student/);
  });
});
